import path from 'node:path';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { config, paths, ROOT } from './config.js';
import { discoverNew } from './discover.js';
import { download } from './download.js';
import { probe, ensureDir } from './ffmpeg.js';
import { transcribe } from './transcribe.js';
import { findHighlights, ts } from './analyze.js';
import { evaluateClips } from './evaluate.js';
import { renderClip } from './render.js';
import { resolveCerebrasModel } from './providers.js';

const MAX_ITER = Number(process.env.AGENT_MAX_ITER || 2);

/**
 * Agentic generate → evaluate loop.
 *
 * On each iteration the generator sees the evaluator's structured critique from
 * the previous attempt, so it knows exactly what kinds of moments to find instead.
 * Iterations stop as soon as the evaluator passes the batch, or MAX_ITER is hit.
 */
async function agentLoop(tr, duration, { count, min, max, log }) {
  let critique = null;
  let best = null;

  for (let iter = 1; iter <= MAX_ITER; iter++) {
    const tag = `iter ${iter}/${MAX_ITER}`;
    log(`\n  [${tag}] generating${critique ? ' (with evaluator feedback)' : ''}`);
    const clips = await findHighlights(tr, duration, { count, min, max, log, critique });

    log(`  [${tag}] evaluating ${clips.length} candidate(s)`);
    const result = await evaluateClips(clips, { log });

    log(`  [${tag}] verdict: ${result.verdict} — ${result.passing.length}/${clips.length} pass threshold`);
    result.passing.forEach((c) =>
      log(`    ${String(c.evalScore).padStart(3)}  [${ts(c.start)}-${ts(c.end)}]  ${c.title}`)
    );

    if (!best || result.passing.length > best.passing.length) best = result;
    if (result.verdict === 'PASS') break;

    if (iter < MAX_ITER && result.globalFeedback) {
      critique = result.globalFeedback;
      log(`  evaluator: "${critique}"`);
    }
  }

  // Prefer evaluated-passing clips; fall back to best available sorted by evalScore
  if (best.passing.length) return best.passing.slice(0, count);
  return [...best.passing, ...best.failing]
    .sort((a, b) => b.evalScore - a.evalScore)
    .slice(0, count);
}

/**
 * Load channel list from channels.json in the project root, if it exists.
 * Falls back to the AGENT_CHANNELS env var (comma-separated URLs).
 */
export function loadChannels() {
  const file = path.join(ROOT, 'channels.json');
  if (existsSync(file)) {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  }
  return (process.env.AGENT_CHANNELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url) => ({ name: url, url }));
}

/**
 * Main agent entry point.
 *
 * Discovers new SMP videos, runs the agentic clip loop for each, renders the
 * winners, and optionally queues them for posting.
 */
export async function runAgent({
  channels,
  count = 5,
  min = 15,
  max = 32, // channel winners cluster at 15-31 s; keep the default focused there
  recentLimit = 3,
  maxVideos = 2,
  targetPending = null,
  post = false,
  log = (m = '') => process.stdout.write(`${m}\n`),
} = {}) {
  const chList = (channels?.length ? channels : loadChannels()).map((c) =>
    typeof c === 'string' ? { name: c, url: c } : c
  );
  if (!chList.length) {
    throw new Error(
      'No channels configured. Add channels.json to the project root, or set AGENT_CHANNELS in .env'
    );
  }

  if (post && Number.isFinite(targetPending)) {
    const { summary } = await import('./queue.js');
    const pending = summary().pending;
    const neededVideos = Math.ceil(Math.max(0, targetPending - pending) / count);
    maxVideos = Math.min(maxVideos, neededVideos);
    if (maxVideos <= 0) {
      log(`queue already has ${pending} pending clip(s); target is ${targetPending} — skipping discovery\n`);
      return [];
    }
  }

  log(`\nagent — watching ${chList.length} channel(s), up to ${MAX_ITER} eval iteration(s) per video`);
  log(`  model: ${await resolveCerebrasModel()}\n`);

  const newVideos = await discoverNew(chList, { limit: recentLimit, maxVideos, log });
  if (!newVideos.length) {
    log('no new videos found\n');
    return [];
  }
  log(`\n${newVideos.length} new video(s) to process`);

  const results = [];

  for (const video of newVideos) {
    log(`\n${'─'.repeat(60)}`);
    log(`${video.title}`);
    log(`${video.channel}  ${video.url}`);

    const workDir = ensureDir(path.join(paths.work, `agent-${video.id}`));
    const outDir = ensureDir(path.join(paths.out, `agent-${video.id}`));

    try {
      log('\n[1/4] downloading');
      const dl = await download(video.url, workDir, { log });

      log('\n[2/4] probing + transcribing');
      const meta = await probe(dl.file);
      if (!meta.hasVideo || !meta.hasAudio) throw new Error('video has no audio stream');
      const tr = await transcribe(dl.file, workDir, { language: 'en', log });
      log(`  ${tr.words.length} words, ${tr.segments.length} segments`);

      log('\n[3/4] agentic clip loop');
      const clips = await agentLoop(tr, meta.duration, { count, min, max, log });
      if (!clips.length) { log('  no usable clips — skipping this video'); continue; }

      log(`\n[4/4] rendering ${clips.length} clip(s) -> ${outDir}`);
      const rendered = [];
      for (const [i, c] of clips.entries()) {
        rendered.push(
          await renderClip(dl.file, c, i, meta, {
            outDir,
            workDir,
            words: tr.words,
            captions: true,
            reframe: 'blur',
            log,
          })
        );
      }

      writeFileSync(
        path.join(outDir, 'clips.json'),
        JSON.stringify({ video, clips: rendered.map(({ file, ...c }) => c) }, null, 2)
      );

      if (post) {
        const { addPath } = await import('./queue.js');
        const channelSlug = video.channel.toLowerCase().replace(/\s+/g, '');
        const { added } = addPath(outDir, {
          tags: `minecraft,smp,${channelSlug},shorts`,
          source: video.url,
        });
        log(`  queued ${added} clip(s)`);
      }

      results.push({ video, clips: rendered });
    } catch (err) {
      log(`  ! ${err.message.split('\n')[0]}`);
    }
  }

  log(`\nagent done — ${results.length}/${newVideos.length} video(s) processed\n`);
  return results;
}
