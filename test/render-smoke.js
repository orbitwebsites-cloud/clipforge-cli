/**
 * Offline smoke test: exercises probe -> caption generation -> ffmpeg render
 * on a synthetic clip. Hits no APIs, so it validates the half of the pipeline
 * that does not depend on Groq/Cerebras keys.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ffmpeg, probe, ensureDir } from '../src/ffmpeg.js';
import { renderClip } from '../src/render.js';
import { ROOT } from '../src/config.js';

const work = ensureDir(path.join(ROOT, 'work', '_smoke'));
const out = ensureDir(path.join(ROOT, 'out', '_smoke'));
const src = path.join(work, 'source.mp4');

const WORDS = 'this is a smoke test of the caption renderer and it should burn every word'.split(' ');

async function main() {
  if (!existsSync(src)) {
    console.log('generating 20s 1920x1080 test source...');
    await ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=20',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', src,
    ]);
  }

  const meta = await probe(src);
  console.log(`source: ${meta.width}x${meta.height} @${meta.fps.toFixed(0)}fps ${meta.duration.toFixed(1)}s audio=${meta.hasAudio}`);

  // Half-second words starting at t=2 so they land inside the clip window.
  const words = WORDS.map((word, i) => ({ word, start: 2 + i * 0.5, end: 2 + i * 0.5 + 0.45 }));
  const clip = { start: 1, end: 13, title: 'Smoke Test Clip', score: 99, reason: 'synthetic' };

  const results = [];
  for (const [i, reframe] of ['blur', 'center'].entries()) {
    const r = await renderClip(src, { ...clip, title: `${reframe} mode` }, i, meta, {
      outDir: out, workDir: work, words, captions: true, reframe, preset: 'ultrafast',
      log: (m) => console.log(m),
    });
    const m = await probe(r.file);
    const pass = m.width === 1080 && m.height === 1920 && m.hasAudio && m.duration > 11;
    console.log(`  verify ${reframe}: ${m.width}x${m.height} ${m.duration.toFixed(1)}s audio=${m.hasAudio} -> ${pass ? 'PASS' : 'FAIL'}`);
    results.push(pass);
  }

  const noCap = await renderClip(src, { ...clip, title: 'no captions' }, 2, meta, {
    outDir: out, workDir: work, words: [], captions: false, reframe: 'blur', preset: 'ultrafast',
    log: () => {},
  });
  const m3 = await probe(noCap.file);
  console.log(`  verify no-captions: ${m3.width}x${m3.height} -> ${m3.width === 1080 ? 'PASS' : 'FAIL'}`);
  results.push(m3.width === 1080);

  console.log(results.every(Boolean) ? '\nALL RENDER TESTS PASSED' : '\nRENDER TESTS FAILED');
  process.exitCode = results.every(Boolean) ? 0 : 1;
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  process.exitCode = 1;
});
