import { spawn } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function run(bin, args, { quiet = true, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, cwd });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => {
      err += d;
      if (!quiet) process.stderr.write(d);
    });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0
        ? resolve({ out, err })
        : reject(new Error(`${path.basename(bin)} exited ${code}\n${err.slice(-2500)}`))
    );
  });
}

export const ffmpeg = (args, opts) => run(paths.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], opts);

export async function probe(file) {
  const { out } = await run(paths.ffprobe, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  const info = JSON.parse(out);
  const video = (info.streams || []).find((s) => s.codec_type === 'video');
  const audio = (info.streams || []).find((s) => s.codec_type === 'audio');
  if (!video && !audio) throw new Error(`No audio or video streams found in ${file}`);
  // ffprobe reports the STORED frame size; a 90/270 rotation tag (common on
  // phone-shot footage) means the DECODED/displayed frame — what ffmpeg's
  // autorotate hands the filtergraph — has width/height swapped from that.
  // Ignoring this flips portrait sources into a landscape crop.
  const rotateTag = Number(video?.tags?.rotate || 0);
  const matrixRotation = (video?.side_data_list || []).find((d) => typeof d.rotation === 'number')?.rotation || 0;
  const rotation = (((rotateTag || matrixRotation) % 360) + 360) % 360;
  const swapped = rotation === 90 || rotation === 270;
  const rawWidth = video ? Number(video.width) : 0;
  const rawHeight = video ? Number(video.height) : 0;
  return {
    duration: Number(info.format?.duration || 0),
    width: swapped ? rawHeight : rawWidth,
    height: swapped ? rawWidth : rawHeight,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
    fps: video ? evalFraction(video.r_frame_rate) : 0,
  };
}

function evalFraction(str) {
  if (!str) return 0;
  const [a, b] = str.split('/').map(Number);
  return b ? a / b : a;
}

/**
 * Extract speech-optimised audio: 16 kHz mono FLAC.
 * Whisper downsamples to 16 kHz anyway, so this is lossless *for the model*
 * while being small enough to stay under Groq's upload limit.
 */
export async function extractAudio(input, workDir) {
  const out = path.join(ensureDir(workDir), 'audio.flac');
  await ffmpeg(['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'flac', out]);
  return out;
}

/** Split audio into fixed-length chunks so long videos stay under the upload cap. */
export async function splitAudio(input, workDir, seconds) {
  const dir = ensureDir(path.join(workDir, 'chunks'));
  await ffmpeg([
    '-i', input,
    '-f', 'segment',
    '-segment_time', String(seconds),
    '-ac', '1', '-ar', '16000', '-c:a', 'flac',
    path.join(dir, 'chunk-%04d.flac'),
  ]);
  const { readdirSync } = await import('node:fs');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.flac'))
    .sort()
    .map((f) => path.join(dir, f));
}

export const sizeMB = (file) => statSync(file).size / (1024 * 1024);
