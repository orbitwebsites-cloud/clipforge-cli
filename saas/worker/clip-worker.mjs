import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const here = path.dirname(fileURLToPath(import.meta.url));
const saasRoot = path.resolve(here, '..');
const engineRoot = path.resolve(saasRoot, '..');

for (const name of ['.env.local', '.env']) {
  const file = path.join(saasRoot, name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('='); const key = line.slice(0, at).trim(); const value = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const [{ download, ytdlpVersion }, { probe, ensureDir }, { transcribe }, { findHighlights }, { evaluateClips }, { renderClip }, { uploadVideo }] = await Promise.all([
  import('../../src/download.js'), import('../../src/ffmpeg.js'), import('../../src/transcribe.js'), import('../../src/analyze.js'), import('../../src/evaluate.js'), import('../../src/render.js'), import('../../src/youtube.js'),
]);

const baseUrl = process.env.CONTROL_PLANE_URL || 'http://localhost:3000';
const secret = process.env.WORKER_SECRET || '';
const workerId = process.env.WORKER_ID || `worker-${randomUUID().slice(0, 8)}`;
const pollMs = Number(process.env.WORKER_POLL_MS || 15000);
const once = process.argv.includes('--once');
const port = Number(process.env.PORT || 0);
const pythonRuntime = process.env.CFC_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const installedYtDlpVersion = await ytdlpVersion();

if (!installedYtDlpVersion) {
  throw new Error(`Worker startup failed: yt-dlp is unavailable through ${pythonRuntime}`);
}
console.log(`Worker media runtime ready (yt-dlp ${installedYtDlpVersion}, ${pythonRuntime})`);

if (port > 0) createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: true, service: 'clipforge-media-worker', workerId }));
}).listen(port, '0.0.0.0', () => console.log(`Worker health server listening on ${port}`));

async function api(route, body) {
  const response = await fetch(`${baseUrl}${route}`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `${route} failed (${response.status})`);
  return result;
}

const progress = (job, status, value, error = null) => api('/api/worker/progress', { jobId: job.id, workerId, status, progress: value, error });

function performanceBrief(job) {
  if (!job.preferences?.learningEnabled) return '';
  const winners = job.performanceData?.shorts?.slice(0, 3) || [];
  if (!winners.length) return '';
  return winners.map((clip, index) => `${index + 1}. "${clip.title}" — ${clip.views} views, ${clip.averageViewDuration}s average view, ${clip.likes + clip.comments} engagements`).join('\n');
}

function captionStyle(preferences) {
  const color = /^#[0-9a-f]{6}$/i.test(preferences.brandColor || '') ? preferences.brandColor : '#C8FF38';
  if (preferences.captionStyle === 'clean') return { font: 'Poppins', fontSize: 78, primary: '#FFFFFF', outline: '#111111', highlight: color, groupSize: 5 };
  if (preferences.captionStyle === 'minimal') return { font: 'Poppins', fontSize: 66, primary: '#FFFFFF', outline: '#111111', highlight: '#FFFFFF', groupSize: 7 };
  return { font: 'Anton', fontSize: 96, primary: '#FFFFFF', outline: '#000000', highlight: color, groupSize: 3 };
}

function tagsFrom(preferences) {
  const tags = String(preferences.hashtags || '#Shorts').match(/#[\p{L}\p{N}_]+/gu) || ['#Shorts'];
  return { line: tags.join(' '), values: tags.map((tag) => tag.slice(1).toLowerCase()).filter(Boolean) };
}

/**
 * Retry a single clip's upload a few times before giving up on it.
 * A transient YouTube 5xx or network blip on clip 3 of 5 must not take down
 * clips 1-2 (already live) or clips 4-5 (rendered and waiting) with it.
 */
async function uploadWithRetry(file, meta, opts, log, tries = 3) {
  let lastErr;
  let resumeLocation = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await uploadVideo(file, meta, { ...opts, resumeLocation });
    } catch (err) {
      lastErr = err;
      // A resumable session survives the attempt that broke it — reuse it
      // next time instead of re-uploading the file from byte 0.
      if (err.location) resumeLocation = err.location;
      if (i === tries - 1) break;
      const wait = Math.min(2 ** i * 3000, 20000);
      log(`  ! upload failed for "${meta.title}" (${err instanceof Error ? err.message : err}) — retrying in ${wait / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastErr;
}

async function selectClips(transcript, duration, log, job) {
  const preferences = job.preferences;
  let critique = null;
  let best = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const candidates = await findHighlights(transcript, duration, { count: Math.max(5, preferences.clipsPerVideo), min: preferences.minClipSeconds, max: preferences.maxClipSeconds, log, critique, performanceBrief: performanceBrief(job) });
    const evaluation = await evaluateClips(candidates, { log });
    if (evaluation.passing.length > best.length) best = evaluation.passing;
    if (evaluation.verdict === 'PASS') break;
    critique = evaluation.globalFeedback;
  }
  return best.slice(0, preferences.clipsPerVideo);
}

async function processJob(job) {
  const log = (message = '') => console.log(`[${job.id.slice(0, 8)}] ${message}`);
  const workDir = ensureDir(path.join(engineRoot, 'work', 'saas', job.tenantId, job.id));
  const outDir = ensureDir(path.join(engineRoot, 'out', 'saas', job.tenantId, job.id));
  const preferences = { publishMode: 'automatic', clipsPerVideo: 3, minClipSeconds: 15, maxClipSeconds: 32, captionStyle: 'impact', brandColor: '#C8FF38', hashtags: '#Shorts #Minecraft', learningEnabled: true, ...(job.preferences || {}) };
  try {
    await progress(job, 'downloading', 8);
    const source = await download(job.sourceUrl, path.join(workDir, 'download'), { log });
    const meta = await probe(source.file);
    await progress(job, 'transcribing', 24);
    const transcript = await transcribe(source.file, workDir, { language: 'en', log });
    await progress(job, 'selecting', 48);
    job.preferences = preferences;
    const clips = (await selectClips(transcript, meta.duration, log, job)).slice(0, Math.max(0, Number(job.maxUploads || 0)));
    if (!clips.length) throw new Error('No clips passed the channel quality gate');
    await progress(job, 'rendering', 62);
    const rendered = [];
    for (const [index, clip] of clips.entries()) rendered.push(await renderClip(source.file, clip, index, meta, { outDir, workDir, words: transcript.words, captions: true, captionStyle: captionStyle(preferences), reframe: 'blur', log }));
    await progress(job, 'uploading', 84);
    const { accessToken } = await api('/api/worker/youtube-token', { channelId: job.channelId });
    const uploaded = [];
    const failedClips = [];
    const hashtags = tagsFrom(preferences);
    const requestedPrivacy = preferences.publishMode === 'review' ? 'private' : 'public';
    for (const clip of rendered) {
      const meta = { title: clip.title, description: `${clip.title}\n\n${hashtags.line}`, tags: hashtags.values, privacyStatus: requestedPrivacy };
      try {
        const result = await uploadWithRetry(clip.file, meta, { token: accessToken, log }, log);
        uploaded.push({ title: clip.title, durationSeconds: Number((clip.end - clip.start).toFixed(2)), youtubeVideoId: result.id, youtubeUrl: result.shortUrl, privacyStatus: result.privacyStatus === 'public' ? 'public' : 'private' });
      } catch (error) {
        // One clip exhausting its retries must not discard clips that already
        // uploaded, or clips still waiting their turn — keep going.
        const message = error instanceof Error ? error.message : String(error);
        log(`  ! giving up on "${clip.title}" after retries: ${message}`);
        failedClips.push({ title: clip.title, error: message });
      }
    }
    if (!uploaded.length) throw new Error(`All ${rendered.length} clip upload(s) failed: ${failedClips.map((f) => f.error).join('; ')}`);
    await api('/api/worker/complete', { jobId: job.id, workerId, clips: uploaded });
    log(`complete: ${uploaded.length}/${rendered.length} Shorts published${failedClips.length ? ` (${failedClips.length} failed after retries — rendered but not uploaded)` : ''}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${job.id}] ${message}`);
    await progress(job, 'failed', 100, message).catch(() => {});
  }
}

console.log(`ClipForge worker ${workerId} polling ${baseUrl}`);
do {
  try {
    const { job } = await api('/api/worker/lease', { workerId });
    if (job) await processJob(job);
    else if (!once) await new Promise((resolve) => setTimeout(resolve, pollMs));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (!once) await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
} while (!once);
