import { connect, installProgressTaps, drain, call, launchApp } from './appdriver.js';
import { startProxy } from './proxy.js';
import { config } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (v) => JSON.stringify(v);

/**
 * Kick off a long bridge call inside the page and poll for its result, so we
 * can stream progress events while it runs. Awaiting the call directly would
 * block until completion with no visibility.
 */
async function runWithProgress(session, expr, { kind, label, log, timeoutMs = 40 * 60_000 }) {
  await session.eval(`
    (() => {
      window.__cfc.result = null;
      Promise.resolve(${expr})
        .then((value) => { window.__cfc.result = { ok: true, value }; })
        .catch((e) => { window.__cfc.result = { ok: false, error: String((e && e.message) || e) }; });
      return true;
    })()
  `);

  const deadline = Date.now() + timeoutMs;
  let lastLine = '';
  while (Date.now() < deadline) {
    for (const p of await drain(session, kind)) {
      const pct = typeof p.progress === 'number' ? `${Math.round(p.progress * 100)}%` : '';
      const line = `  ${label} ${pct} ${p.message || p.stage || ''}`.replace(/\s+/g, ' ').trim();
      if (line !== lastLine) {
        log(line);
        lastLine = line;
      }
    }
    const result = await session.eval('window.__cfc.result');
    if (result) {
      if (!result.ok) throw new Error(result.error);
      return result.value;
    }
    await sleep(700);
  }
  throw new Error(`${label} timed out after ${Math.round(timeoutMs / 60000)} minutes`);
}

export async function runAppPipeline(target, opts = {}) {
  const {
    isUrl,
    outputDir,
    count = 5,
    aspect = '9:16',
    clipLength = 'auto',
    videoType = 'auto',
    hookFirst = true,
    // Only fields the caller explicitly set. ClipForge picks reframeMode /
    // framing / autoZoom from the videoType and the detected focus track, and
    // overriding that blindly produces worse crops than letting it decide.
    editOverrides = {},
    prompt = '',
    cdpPort = 9333,
    keepOpen = false,
    exportClips = true,
    resumeProjectId = null,
    log = () => {},
  } = opts;

  const { server, baseUrl } = await startProxy({ port: config.proxyPort, log: () => {} });
  log(`  router up on ${baseUrl}`);

  const child = launchApp({ port: cdpPort, baseUrl });
  let session;
  // Track in-flight work so Ctrl+C can ask ClipForge to abort cleanly. Killing
  // the process outright leaves a half-written mp4 behind, because the app's
  // own abort handler (which deletes the partial file) never runs.
  const inFlight = { projectId: null, clipId: null };
  let interrupted = false;
  const onSignal = async () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    log('\n  interrupt — asking ClipForge to cancel and clean up…');
    try {
      if (session && inFlight.clipId) await call(session, 'cancelExport', [inFlight.clipId]);
      if (session && inFlight.projectId) await call(session, 'cancelAnalyze', [inFlight.projectId]);
      await sleep(1500);
    } catch {
      /* best effort */
    }
    try {
      session?.close();
      child.kill();
      server.close();
    } catch {
      /* already gone */
    }
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    session = await connect(cdpPort);
    log('  connected to ClipForge over CDP');
    await installProgressTaps(session);

    const settings = await call(session, 'getSettings');
    if (!settings?.hasApiKey) {
      throw new Error('ClipForge reports no API key even though OPENAI_API_KEY was injected.');
    }

    log(`\n[1/3] ${resumeProjectId ? 'loading existing project' : 'creating project'}`);
    const project = resumeProjectId
      ? await call(session, 'loadProject', [resumeProjectId])
      : isUrl
      ? await runWithProgress(session, `window.clipforge.createProjectFromUrl(${j(target)})`, {
          kind: 'import',
          label: 'download',
          log,
          timeoutMs: 30 * 60_000,
        })
      : await call(session, 'createProject', [target], { timeout: 300_000 });

    if (!project?.id) throw new Error(`Project creation returned no id: ${j(project)}`);
    inFlight.projectId = project.id;
    log(`  project ${project.id} — "${project.name || project.video?.path || target}"`);

    log(`\n[2/3] analyzing (ClipForge engine, via Groq + Cerebras)`);
    const analyzeOpts = { videoType, clipLength, hookFirst, broll: false, prompt };
    await runWithProgress(
      session,
      `window.clipforge.analyzeProject(${j(project.id)}, ${j(analyzeOpts)})`,
      { kind: 'pipeline', label: 'analyze', log }
    );

    let loaded = await call(session, 'loadProject', [project.id]);
    let clips = (loaded.clips || []).slice(0, count);
    if (!clips.length) throw new Error('Analysis produced no clips.');
    log(`  ${loaded.clips.length} clips found, taking ${clips.length}`);

    // Apply framing/caption settings through the app's own updateClip so the
    // export uses ClipForge's speaker tracking rather than a static crop.
    for (const clip of clips) {
      const edit = { ...clip.edit, aspect, ...editOverrides };
      await call(session, 'updateClip', [project.id, { ...clip, edit }]);
    }
    const overridden = Object.keys(editOverrides);
    log(`  aspect ${aspect}${overridden.length ? `, overrides: ${overridden.join(', ')}` : ', framing left to ClipForge'}`);
    loaded = await call(session, 'loadProject', [project.id]);
    clips = (loaded.clips || []).slice(0, count);

    const results = clips.map((c) => ({
      id: c.id,
      title: c.title,
      start: c.edit?.start ?? c.start,
      end: c.edit?.end ?? c.end,
      score: c.score ?? c.virality ?? null,
      reason: c.reason || c.rationale || '',
    }));

    if (!exportClips) {
      log('\n[3/3] skipped export (--no-export)');
      return { project: project.id, clips: results, outputDir: null };
    }

    log(`\n[3/3] exporting ${clips.length} clips -> ${outputDir}`);
    const files = [];
    for (const [i, clip] of clips.entries()) {
      log(`  (${i + 1}/${clips.length}) ${clip.title}`);
      inFlight.clipId = clip.id;
      const out = await runWithProgress(
        session,
        `window.clipforge.exportClip(${j(project.id)}, ${j({ clipId: clip.id, outputDir })})`,
        { kind: 'export', label: 'render', log, timeoutMs: 30 * 60_000 }
      );
      files.push(typeof out === 'string' ? out : out?.outputPath || out?.path || null);
      inFlight.clipId = null;
    }
    return { project: project.id, clips: results, files, outputDir };
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (!keepOpen) {
      session?.close();
      try {
        child.kill();
      } catch {
        /* already exited */
      }
    }
    server.close();
  }
}
