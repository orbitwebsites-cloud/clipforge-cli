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

const [{ download }, { probe, ensureDir }, { transcribe }, { findHighlights }, { evaluateClips }, { renderClip }, { uploadVideo }] = await Promise.all([
  import('../../src/download.js'), import('../../src/ffmpeg.js'), import('../../src/transcribe.js'), import('../../src/analyze.js'), import('../../src/evaluate.js'), import('../../src/render.js'), import('../../src/youtube.js'),
]);

const baseUrl = process.env.CONTROL_PLANE_URL || 'http://localhost:3000';
const secret = process.env.WORKER_SECRET || '';
const workerId = process.env.WORKER_ID || `worker-${randomUUID().slice(0, 8)}`;
const pollMs = Number(process.env.WORKER_POLL_MS || 15000);
const once = process.argv.includes('--once');
const port = Number(process.env.PORT || 0);

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

async function selectClips(transcript, duration, log) {
  let critique = null;
  let best = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const candidates = await findHighlights(transcript, duration, { count: 5, min: 15, max: 32, log, critique });
    const evaluation = await evaluateClips(candidates, { log });
    if (evaluation.passing.length > best.length) best = evaluation.passing;
    if (evaluation.verdict === 'PASS') break;
    critique = evaluation.globalFeedback;
  }
  return best.slice(0, 5);
}

async function processJob(job) {
  const log = (message = '') => console.log(`[${job.id.slice(0, 8)}] ${message}`);
  const workDir = ensureDir(path.join(engineRoot, 'work', 'saas', job.tenantId, job.id));
  const outDir = ensureDir(path.join(engineRoot, 'out', 'saas', job.tenantId, job.id));
  try {
    await progress(job, 'downloading', 8);
    const source = await download(job.sourceUrl, path.join(workDir, 'download'), { log });
    const meta = await probe(source.file);
    await progress(job, 'transcribing', 24);
    const transcript = await transcribe(source.file, workDir, { language: 'en', log });
    await progress(job, 'selecting', 48);
    const clips = (await selectClips(transcript, meta.duration, log)).slice(0, Math.max(0, Number(job.maxUploads || 0)));
    if (!clips.length) throw new Error('No clips passed the channel quality gate');
    await progress(job, 'rendering', 62);
    const rendered = [];
    for (const [index, clip] of clips.entries()) rendered.push(await renderClip(source.file, clip, index, meta, { outDir, workDir, words: transcript.words, captions: true, reframe: 'blur', log }));
    await progress(job, 'uploading', 84);
    const { accessToken } = await api('/api/worker/youtube-token', { channelId: job.channelId });
    const uploaded = [];
    for (const clip of rendered) {
      const result = await uploadVideo(clip.file, { title: clip.title, description: `${clip.title}\n\n#Shorts #Minecraft`, tags: ['minecraft', 'shorts'], privacyStatus: 'public' }, { token: accessToken, log });
      uploaded.push({ title: clip.title, durationSeconds: Number((clip.end - clip.start).toFixed(2)), youtubeVideoId: result.id, youtubeUrl: result.shortUrl });
    }
    await api('/api/worker/complete', { jobId: job.id, workerId, clips: uploaded });
    log(`complete: ${uploaded.length} Shorts published`);
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
