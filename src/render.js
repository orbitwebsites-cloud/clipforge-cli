import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { ffmpeg, ensureDir } from './ffmpeg.js';
import { writeCaptions } from './captions.js';

const W = 1080;
const H = 1920;
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Compute a 9:16 crop rect from the source dimensions. */
function cropRect(sw, sh, mode) {
  const target = 9 / 16;
  let cw;
  let ch;
  if (sw / sh > target) {
    ch = sh;
    cw = even(sh * target);
  } else {
    cw = sw;
    ch = even(sw / target);
  }
  cw = Math.min(even(cw), sw);
  ch = Math.min(even(ch), sh);
  const x = mode === 'left' ? 0 : mode === 'right' ? sw - cw : Math.round((sw - cw) / 2);
  const y = Math.round((sh - ch) / 2);
  return { cw, ch, x: Math.max(0, x), y: Math.max(0, y) };
}

function videoChain(meta, reframe) {
  if (reframe === 'blur') {
    // Fit the whole frame inside 1080x1920 over a blurred, darkened fill —
    // nothing is cropped away, which is the safe default when we cannot
    // track who is speaking.
    return (
      `[0:v]split=2[bg][fg];` +
      `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
      `gblur=sigma=40,eq=brightness=-0.12[bgb];` +
      `[fg]scale=${W}:-2:force_original_aspect_ratio=decrease[fgs];` +
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2[vout]`
    );
  }
  const { cw, ch, x, y } = cropRect(meta.width, meta.height, reframe);
  return `[0:v]crop=${cw}:${ch}:${x}:${y},scale=${W}:${H}:flags=lanczos,setsar=1[vout]`;
}

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'clip';

/**
 * Cut one clip, reframe it to 1080x1920, and optionally burn karaoke captions.
 * ffmpeg runs with cwd set to the clip's work dir so every filter path stays
 * relative — Windows drive letters inside the subtitles filter are a
 * well-known escaping trap.
 */
export async function renderClip(input, clip, index, meta, opts = {}) {
  const {
    outDir,
    workDir,
    words = [],
    captions = true,
    reframe = 'blur',
    crf = 20,
    preset = 'veryfast',
    log = () => {},
  } = opts;

  ensureDir(outDir);
  const dir = ensureDir(path.join(workDir, `clip-${String(index + 1).padStart(2, '0')}`));
  const name = `${String(index + 1).padStart(2, '0')}-${slug(clip.title)}.mp4`;
  const outFile = path.join(outDir, name);
  const duration = clip.end - clip.start;

  let chain = videoChain(meta, reframe);
  if (captions && words.length) {
    const assFile = path.join(dir, 'captions.ass');
    const { count } = writeCaptions(words, clip.start, clip.end, assFile, opts.captionStyle);
    if (count) {
      for (const font of ['Anton-Regular.ttf', 'Poppins-Bold.ttf']) {
        const src = path.join(paths.fonts, font);
        if (existsSync(src)) copyFileSync(src, path.join(dir, font));
      }
      chain = chain.replace('[vout]', '[vpre];[vpre]subtitles=captions.ass:fontsdir=.[vout]');
    }
  }

  await ffmpeg(
    [
      '-ss', clip.start.toFixed(3),
      '-t', duration.toFixed(3),
      '-i', input,
      '-filter_complex', chain,
      '-map', '[vout]',
      ...(meta.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '160k', '-ac', '2'] : ['-an']),
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
      '-crf', String(crf),
      '-preset', preset,
      '-r', '30',
      '-movflags', '+faststart',
      outFile,
    ],
    { cwd: dir }
  );

  log(`  -> ${name}  (${duration.toFixed(1)}s, score ${clip.score})`);
  return { file: outFile, name, ...clip };
}
