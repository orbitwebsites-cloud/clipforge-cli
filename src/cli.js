#!/usr/bin/env node
import { existsSync, writeFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { config, paths, ROOT } from './config.js';
import { cerebras, resolveCerebrasModel } from './providers.js';
import { probe, ensureDir } from './ffmpeg.js';
import { transcribe } from './transcribe.js';
import { findHighlights, ts } from './analyze.js';
import { renderClip } from './render.js';
import { startProxy } from './proxy.js';
import { download, isUrl, ytdlpVersion } from './download.js';
import { runAppPipeline } from './appflow.js';

const log = (m = '') => process.stdout.write(`${m}\n`);
const ok = (m) => log(`  \x1b[32mOK\x1b[0m   ${m}`);
const bad = (m) => log(`  \x1b[31mFAIL\x1b[0m ${m}`);
const warn = (m) => log(`  \x1b[33mWARN\x1b[0m ${m}`);

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      if (inline !== undefined) flags[k] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

const USAGE = `
cfc — headless ClipForge driver on Groq + Cerebras

  cfc doctor                     Verify install, keys, and reachable models
  cfc app <file|url> [options]   Drive the real ClipForge engine headlessly
  cfc clip <file|url> [options]  Standalone pipeline (no ClipForge, no speaker tracking)
  cfc agent [options]            Discover new SMP videos, clip, and queue posts
  cfc queue add --dir <folder>   Add rendered clips to the posting queue
  cfc queue                      Show queue status
  cfc post-next                  Upload one queued clip (what the scheduler runs)
  cfc publish <file|dir>         Upload clips to YouTube (private by default)
  cfc yt-auth                    One-time browser consent to mint a refresh token
  cfc proxy [--port 8787]        Run the OpenAI-compatible router on its own
  cfc launch                     Start the router and open the ClipForge GUI on it

publish options
  --public / --unlisted   visibility (default private); --public also needs --yes
  --title <text>          override title (single file only)
  --desc <text>           description  (default "<title>\\n\\n#Shorts")
  --tags a,b,c            comma-separated tags
  --made-for-kids         set the kids flag

app options
  --n <count>        clips to export             (default 5)
  --aspect <ratio>   9:16 | 1:1 | 16:9 | original (default 9:16)
  --length <preset>  auto | short | medium | long (default auto)
  --type <kind>      auto | talking-head | podcast | webinar | product-demo
  --reframe <mode>   crop | fit-blur | fit-letterbox  (default: ClipForge decides)
  --framing <mode>   auto (speaker tracking) | manual (default: ClipForge decides)
  --no-zoom          disable auto zoom
  --prompt <text>    extra steering for clip selection
  --out <dir>        output directory
  --no-captions      disable burned-in captions
  --no-export        analyze only, list clips, render nothing
  --keep-open        leave ClipForge running when done
  --cdp-port <n>     debug port for this app instance (default 9333)
  --project <id>     resume an existing ClipForge project (reuses transcript)

agent options
  --channels <urls>  comma-separated channel URLs (or edit channels.json in project root)
  --n <count>        clips per video (default 5)
  --min <seconds>    minimum clip length (default 15)
  --max <seconds>    maximum clip length (default 32)
  --recent <count>   recent uploads checked per channel (default 3)
  --max-videos <n>   maximum fresh videos processed per run (default 2)
  --target-pending <n> skip discovery when this many clips are queued
  --post             add rendered clips to the posting queue
  Schedule with Windows Task Scheduler or cron for continuous operation.

clip options
  --n <count>        clips to produce            (default 5)
  --min <seconds>    minimum clip length         (default 15)
  --max <seconds>    maximum clip length         (default 75)
  --reframe <mode>   blur | center | left | right (default blur)
  --lang <code>      transcription language hint (default en)
  --out <dir>        output directory            (default ./out/<name>)
  --no-captions      skip burned-in captions
  --dry-run          transcribe and rank only, render nothing
  --keep-work        keep intermediate audio and subtitle files
`;

async function doctor() {
  log('\nClipForge');
  existsSync(paths.clipforgeExe) ? ok(`app      ${paths.clipforgeExe}`) : bad(`app not found at ${paths.clipforgeExe}`);
  existsSync(paths.ffmpeg) ? ok('ffmpeg   bundled') : bad(`ffmpeg missing at ${paths.ffmpeg}`);
  existsSync(paths.ffprobe) ? ok('ffprobe  bundled') : bad(`ffprobe missing at ${paths.ffprobe}`);
  existsSync(paths.fonts) ? ok('fonts    Anton + Poppins') : warn('caption fonts not found — captions fall back to a system font');
  const ytv = await ytdlpVersion();
  ytv ? ok(`yt-dlp   ${ytv}`) : warn('yt-dlp not found — URL input disabled (python -m pip install -U yt-dlp)');

  log('\nDeepgram (transcription)');
  if (!config.deepgramKey) bad('DEEPGRAM_API_KEY not set in .env');
  else {
    try {
      // Deepgram has no model-catalog endpoint; /projects is the cheapest call
      // that proves the key authenticates. A member-scoped key can 403 here
      // while still transcribing fine, so that case is a warning, not a failure.
      const res = await fetch(`${config.deepgramBase}/projects`, {
        headers: { Authorization: `Token ${config.deepgramKey}` },
      });
      if (res.ok) ok(`key valid — transcription model: ${config.deepgramModel}`);
      else if (res.status === 403) warn(`key lacks project scope (403) — transcription may still work. Model: ${config.deepgramModel}`);
      else bad(`key rejected (HTTP ${res.status})`);
    } catch (err) {
      bad(`request failed: ${err.message.split('\n')[0]}`);
    }
  }

  log('\nCerebras (highlight ranking)');
  if (!config.cerebrasKey) bad('CEREBRAS_API_KEY not set in .env');
  else {
    try {
      const models = (await cerebras.models()).data.map((m) => m.id);
      ok(`key valid — ${models.length} models visible`);
      log(`       ${models.join(', ')}`);
      ok(`selected: ${await resolveCerebrasModel()}`);
    } catch (err) {
      bad(`request failed: ${err.message.split('\n')[0]}`);
    }
  }
  log('');
}

async function clip(target, flags) {
  if (!target) throw new Error('Usage: cfc clip <file|url> [options]');

  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'video';

  let input;
  let name;
  let workDir;
  if (isUrl(target)) {
    if (!(await ytdlpVersion())) {
      throw new Error('yt-dlp is not available. Install it with: python -m pip install -U yt-dlp');
    }
    log('\n[0/4] downloading');
    workDir = ensureDir(path.join(paths.work, `dl-${Date.now()}`));
    const dl = await download(target, workDir, { log });
    input = dl.file;
    name = slugify(dl.title);
  } else {
    input = path.resolve(target);
    if (!existsSync(input)) throw new Error(`No such file: ${input}`);
    name = path.basename(input, path.extname(input));
    workDir = ensureDir(path.join(paths.work, name));
  }

  const outDir = flags.out ? path.resolve(flags.out) : path.join(paths.out, name);
  const count = Number(flags.n || 5);
  const min = Number(flags.min || 15);
  const max = Number(flags.max || 75);
  const reframe = String(flags.reframe || 'blur');
  if (!['blur', 'center', 'left', 'right'].includes(reframe)) throw new Error(`Unknown --reframe: ${reframe}`);

  log(`\n[1/4] probing ${path.basename(input)}`);
  const meta = await probe(input);
  if (!meta.hasVideo) throw new Error('Input has no video stream.');
  if (!meta.hasAudio) throw new Error('Input has no audio stream — nothing to transcribe.');
  log(`  ${meta.width}x${meta.height} @ ${meta.fps.toFixed(0)}fps, ${ts(meta.duration)} long`);

  log('\n[2/4] transcribing');
  const tr = await transcribe(input, workDir, { language: flags.lang || 'en', log });
  log(`  ${tr.words.length} words, ${tr.segments.length} segments`);

  log('\n[3/4] finding highlights');
  const clips = await findHighlights(tr, meta.duration, { count, min, max, log });
  log('');
  clips.forEach((c, i) =>
    log(`  ${String(i + 1).padStart(2)}. [${ts(c.start)}-${ts(c.end)}] ${c.score.toString().padStart(3)}  ${c.title}\n      ${c.reason}`)
  );

  const manifest = { source: input, generatedFrom: { transcription: `deepgram/${config.deepgramModel}`, ranking: `cerebras/${await resolveCerebrasModel()}` }, clips };

  if (flags['dry-run']) {
    ensureDir(outDir);
    writeFileSync(path.join(outDir, 'clips.json'), JSON.stringify(manifest, null, 2));
    log(`\nDry run — no video rendered. Plan written to ${path.join(outDir, 'clips.json')}\n`);
    return;
  }

  log(`\n[4/4] rendering ${clips.length} clips -> ${outDir}`);
  const rendered = [];
  for (const [i, c] of clips.entries()) {
    rendered.push(
      await renderClip(input, c, i, meta, {
        outDir,
        workDir,
        words: tr.words,
        captions: !flags['no-captions'],
        reframe,
        log,
      })
    );
  }

  writeFileSync(
    path.join(outDir, 'clips.json'),
    JSON.stringify({ ...manifest, clips: rendered.map(({ file, ...c }) => c) }, null, 2)
  );
  if (!flags['keep-work']) rmSync(workDir, { recursive: true, force: true });
  log(`\nDone — ${rendered.length} clips in ${outDir}\n`);
}

async function ytAuth(flags) {
  const { authorize, saveRefreshToken } = await import('./youtube.js');
  const token = await authorize({ port: Number(flags.port || 8788), log });
  const file = saveRefreshToken(token);
  log(`\nRefresh token saved to ${file}`);
  log('Note: while the OAuth consent screen is in "Testing", Google expires this after 7 days.');
  log('Set it to "In production" in the Google Cloud console to make it durable.\n');
}

async function publish(target, flags) {
  const { uploadVideo, accessToken } = await import('./youtube.js');
  if (!target) throw new Error('Usage: cfc publish <file|dir> [--public] [--title ...]');

  const abs = path.resolve(target);
  if (!existsSync(abs)) throw new Error(`No such path: ${abs}`);
  const files = statSync(abs).isDirectory()
    ? readdirSync(abs).filter((f) => f.toLowerCase().endsWith('.mp4')).map((f) => path.join(abs, f))
    : [abs];
  if (!files.length) throw new Error(`No .mp4 files in ${abs}`);

  const { remainingUploads, recordUpload, quotaStatus } = await import('./quota.js');
  const privacyStatus = flags.public ? 'public' : flags.unlisted ? 'unlisted' : 'private';

  // Stop before the API does. Uploading a 30 MB body only to eat a quota 403
  // wastes minutes and tells the user nothing useful.
  const q = quotaStatus();
  const room = flags['ignore-quota'] ? files.length : remainingUploads();
  log(`\nquota: ${q.used}/${q.limit} units used today (Pacific ${q.day}) — room for ${q.remainingUploads} more upload(s)`);
  if (room <= 0) {
    log('Daily upload quota is spent. It resets at midnight US/Pacific.\n');
    return;
  }
  if (files.length > room) {
    log(`Trimming ${files.length} file(s) to ${room} to stay inside today's quota.`);
    files.length = room;
  }

  // Publishing to a public feed is not reversible in the way a local render is,
  // so it takes an explicit opt-in rather than a default.
  if (privacyStatus === 'public' && !flags.yes) {
    log(`\nAbout to upload ${files.length} video(s) as PUBLIC:`);
    files.forEach((f) => log(`  ${path.basename(f)}`));
    log('\nRe-run with --yes to confirm, or drop --public to upload privately.\n');
    return;
  }

  await accessToken(); // fail fast on auth before uploading bytes
  log(`\npublishing ${files.length} video(s) as ${privacyStatus}`);

  const done = [];
  for (const [i, file] of files.entries()) {
    const base = path.basename(file, '.mp4').replace(/\s*\(9x16\)$/, '');
    const title = files.length === 1 && flags.title ? String(flags.title) : base;
    log(`\n(${i + 1}/${files.length}) ${title}`);
    try {
      const res = await uploadVideo(
        file,
        {
          title,
          description: typeof flags.desc === 'string' ? flags.desc : `${title}\n\n#Shorts`,
          tags: flags.tags ? String(flags.tags).split(',').map((t) => t.trim()) : undefined,
          privacyStatus,
          madeForKids: Boolean(flags['made-for-kids']),
        },
        { log }
      );
      recordUpload();
      log(`  ${res.shortUrl}  [${res.privacyStatus}]`);
      done.push(res);
    } catch (err) {
      log(`  FAILED: ${err.message.split('\n')[0]}`);
      // Both ceilings are daily and channel-wide — every remaining file in the
      // batch would fail identically, so stop rather than grind through them.
      if (err.reason === 'uploadLimitExceeded' || err.reason === 'quotaExceeded') {
        log(`  Stopping — ${files.length - i - 1} file(s) left unqueued. Retry after the daily reset.`);
        break;
      }
    }
  }
  log(`\n${done.length}/${files.length} uploaded\n`);
  if (done.some((d) => d.privacyStatus === 'private') && privacyStatus !== 'private') {
    log('Some uploads came back private despite the request — that happens when the Google Cloud');
    log('project has not passed OAuth verification. Unaudited clients cannot publish publicly.\n');
  }
}

async function queue(target, flags) {
  const q = await import('./queue.js');
  const sub = String(target || 'list');

  if (sub === 'add') {
    const dir = flags.dir || flags.path;
    if (!dir) throw new Error('Usage: cfc queue add --dir <folder> [--tags a,b]');
    const res = q.addPath(String(dir), { tags: flags.tags ? String(flags.tags) : null, source: flags.source });
    log(`\nadded ${res.added}, skipped ${res.skipped} already queued — ${res.total} total\n`);
    return;
  }
  if (sub === 'reset') {
    const items = q.list();
    for (const i of items) if (i.status === 'failed') { i.status = 'pending'; i.attempts = 0; }
    q.save({ items });
    log('\nfailed items reset to pending\n');
    return;
  }

  const s = q.summary();
  log(`\nqueue: ${s.pending} pending, ${s.posted} posted, ${s.failed} failed (${s.total} total)\n`);
  for (const i of q.list()) {
    const mark = i.status === 'posted' ? 'x' : i.status === 'failed' ? '!' : ' ';
    log(`  [${mark}] ${i.title}${i.url ? `  ${i.url}` : ''}${i.lastError ? `  (${i.lastError.split('\n')[0].slice(0, 60)})` : ''}`);
  }
  log('');
}

/** Upload exactly one queued clip. This is what the scheduler calls. */
async function postNext(flags) {
  const q = await import('./queue.js');
  const { uploadVideo } = await import('./youtube.js');
  const { remainingUploads, recordUpload } = await import('./quota.js');

  if (!q.acquireLock()) {
    log('another post-next run holds the lock — skipping this slot');
    return;
  }
  try {
    const item = q.nextPending();
    if (!item) {
      log(`nothing pending (${JSON.stringify(q.summary())})`);
      return;
    }
    if (remainingUploads() <= 0 && !flags['ignore-quota']) {
      log('API quota spent for today (resets midnight US/Pacific) — leaving item queued');
      return;
    }

    const privacyStatus = flags.private ? 'private' : flags.unlisted ? 'unlisted' : 'public';
    log(`posting: ${item.title}  [${privacyStatus}]`);
    try {
      const res = await uploadVideo(
        item.file,
        {
          title: item.title,
          description: `${item.title}\n\n#Shorts #lifesteal #minecraft`,
          tags: (item.tags || 'lifesteal,lifestealsmp,minecraft,shorts').split(',').map((t) => t.trim()),
          privacyStatus,
        },
        { log }
      );
      recordUpload();
      q.markPosted(item.file, res);
      log(`posted ${res.shortUrl} [${res.privacyStatus}]`);
    } catch (err) {
      q.markFailed(item.file, err.message);
      log(`FAILED: ${err.message.split('\n')[0]}`);
      // Daily ceilings are expected, not errors worth a non-zero exit — the
      // next scheduled slot retries the same item.
      if (err.reason !== 'uploadLimitExceeded' && err.reason !== 'quotaExceeded') process.exitCode = 1;
    }
  } finally {
    q.releaseLock();
  }
}

async function proxy(flags) {
  const port = Number(flags.port || config.proxyPort);
  const { baseUrl } = await startProxy({ port, log });
  log(`\ncfc router listening on ${baseUrl}`);
  log(`  /audio/transcriptions -> deepgram/${config.deepgramModel}`);
  log(`  /chat/completions     -> cerebras/${await resolveCerebrasModel()}`);
  log('\nPoint any OpenAI client at that base URL. Ctrl+C to stop.\n');
}

async function launch(flags) {
  if (!existsSync(paths.clipforgeExe)) throw new Error(`ClipForge not found at ${paths.clipforgeExe}`);
  const port = Number(flags.port || config.proxyPort);
  const { baseUrl } = await startProxy({ port, log });
  log(`\nrouter up on ${baseUrl}`);

  const child = spawn(paths.clipforgeExe, [], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      OPENAI_BASE_URL: baseUrl,
      OPENAI_API_BASE: baseUrl,
      // ClipForge sends this through to the router, which swaps in the real
      // provider keys. Any non-empty value satisfies its client-side check.
      OPENAI_API_KEY: 'cfc-router',
    },
  });
  child.unref();
  log('ClipForge launched against the router.');
  log('If it still asks for an API key in Settings, paste any non-empty text — the router supplies the real ones.');
  log('\nLeave this terminal open; closing it stops the router. Ctrl+C to quit.\n');
}

async function app(target, flags) {
  const resumeProjectId = typeof flags.project === 'string' ? flags.project : null;
  if (!target && !resumeProjectId) throw new Error('Usage: cfc app <file|url> [options]');
  const url = target ? isUrl(target) : false;
  if (target && !url) {
    const abs = path.resolve(target);
    if (!existsSync(abs)) throw new Error(`No such file: ${abs}`);
    target = abs;
  }
  const label = resumeProjectId || (url ? new URL(target).hostname : path.basename(target, path.extname(target)));
  const outDir = ensureDir(flags.out ? path.resolve(flags.out) : path.join(paths.out, `app-${label}`));

  const VIDEO_TYPES = ['auto', 'talking-head', 'podcast', 'webinar', 'product-demo'];
  const videoType = String(flags.type || 'auto');
  if (!VIDEO_TYPES.includes(videoType)) {
    throw new Error(`--type must be one of: ${VIDEO_TYPES.join(', ')}`);
  }
  const aspect = String(flags.aspect || '9:16');
  if (!['9:16', '1:1', '16:9', 'original'].includes(aspect)) {
    throw new Error('--aspect must be one of: 9:16, 1:1, 16:9, original');
  }

  // Build overrides from explicitly-passed flags only, so ClipForge's own
  // videoType/focus-track layout logic stays in charge by default.
  const editOverrides = {};
  if (flags.reframe) editOverrides.reframeMode = String(flags.reframe);
  if (flags.framing) editOverrides.framing = String(flags.framing);
  if (flags['no-captions']) editOverrides.captionsEnabled = false;
  if (flags['no-zoom']) editOverrides.autoZoom = false;

  log(`\ndriving ClipForge on ${resumeProjectId ? 'project' : url ? 'URL' : 'file'}: ${resumeProjectId || target}`);
  const res = await runAppPipeline(target, {
    isUrl: url,
    outputDir: outDir,
    count: Number(flags.n || 5),
    aspect,
    clipLength: String(flags.length || 'auto'),
    videoType,
    editOverrides,
    prompt: typeof flags.prompt === 'string' ? flags.prompt : '',
    exportClips: !flags['no-export'],
    keepOpen: Boolean(flags['keep-open']),
    cdpPort: Number(flags['cdp-port'] || 9333),
    resumeProjectId,
    log,
  });

  log('');
  res.clips.forEach((c, i) =>
    log(`  ${String(i + 1).padStart(2)}. [${ts(c.start)}-${ts(c.end)}] ${c.score ?? '--'}  ${c.title}`)
  );
  writeFileSync(path.join(outDir, 'clips.json'), JSON.stringify(res, null, 2));
  log(`\nDone — ${res.files ? `${res.files.filter(Boolean).length} files in ${outDir}` : `manifest in ${outDir}`}\n`);
}

async function agent(flags) {
  const { runAgent, loadChannels } = await import('./agent.js');
  const channels = flags.channels
    ? String(flags.channels).split(',').map((s) => ({ name: s.trim(), url: s.trim() }))
    : loadChannels();
  await runAgent({
    channels,
    count: Number(flags.n || 5),
    min: Number(flags.min || 15),
    max: Number(flags.max || 32),
    recentLimit: Number(flags.recent || 3),
    maxVideos: Number(flags['max-videos'] || 2),
    targetPending: flags['target-pending'] === undefined ? null : Number(flags['target-pending']),
    post: Boolean(flags.post),
  });
}

const commands = {
  doctor, clip, app, proxy, launch, publish, queue, agent,
  'yt-auth': ytAuth,
  'post-next': postNext,
};

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const cmd = positional.shift();
  if (!cmd || flags.help || cmd === 'help') return log(USAGE);
  const fn = commands[cmd];
  if (!fn) {
    log(`Unknown command: ${cmd}`);
    log(USAGE);
    process.exitCode = 1;
    return;
  }
  if (['clip', 'app', 'publish', 'queue'].includes(cmd)) return fn(positional[0], flags);
  if (cmd === 'agent') return fn(flags);
  return fn(flags);
}

main().catch((err) => {
  log(`\n\x1b[31mError\x1b[0m ${err.message}\n`);
  process.exitCode = 1;
});
