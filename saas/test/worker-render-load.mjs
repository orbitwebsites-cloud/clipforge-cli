import { existsSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ffmpeg, probe, ensureDir } from '../../src/ffmpeg.js';
import { renderClip } from '../../src/render.js';
import { ROOT } from '../../src/config.js';

const root = ensureDir(path.join(ROOT, 'work', '_worker-load'));
const source = path.join(root, 'source.mp4');
if (!existsSync(source)) {
  await ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', source,
  ]);
}

const meta = await probe(source);
const words = 'one hundred creators rendering captioned clips at the exact same time'.split(' ').map((word, index) => ({
  word,
  start: 1 + index * 0.4,
  end: 1.35 + index * 0.4,
}));

async function renderUser(level, index) {
  const workDir = ensureDir(path.join(root, `level-${level}`, `user-${index}`, 'work'));
  const outDir = ensureDir(path.join(root, `level-${level}`, `user-${index}`, 'out'));
  const started = performance.now();
  await renderClip(source, {
    start: 0.5,
    end: 6.5,
    title: `Load user ${index}`,
    score: 99,
    reason: 'load test',
  }, 0, meta, {
    outDir,
    workDir,
    words,
    captions: true,
    reframe: 'blur',
    preset: 'veryfast',
  });
  return performance.now() - started;
}

const results = [];
for (const concurrency of [1, 2, 4, 8]) {
  const started = performance.now();
  const settled = await Promise.allSettled(Array.from({ length: concurrency }, (_, index) => renderUser(concurrency, index)));
  const elapsedMs = performance.now() - started;
  const durations = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value);
  results.push({
    concurrency,
    completed: durations.length,
    failed: settled.length - durations.length,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    averageJobMs: durations.length ? Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(1)) : null,
    maxJobMs: durations.length ? Number(Math.max(...durations).toFixed(1)) : null,
    clipsPerMinute: Number((durations.length / (elapsedMs / 60000)).toFixed(2)),
    sampleError: settled.find((item) => item.status === 'rejected')?.reason?.message || null,
  });
}

console.log(JSON.stringify({ source: { width: meta.width, height: meta.height, duration: meta.duration }, clipSeconds: 6, preset: 'veryfast', results }, null, 2));
