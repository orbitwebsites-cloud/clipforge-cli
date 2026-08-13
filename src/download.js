import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { run, ensureDir } from './ffmpeg.js';

const PY = process.env.CFC_PYTHON || 'python';

export async function ytdlpVersion() {
  try {
    const { out } = await run(PY, ['-m', 'yt_dlp', '--version']);
    return out.trim();
  } catch {
    return null;
  }
}

export const isUrl = (s) => /^https?:\/\//i.test(s);

/**
 * Download a video to workDir and return its local path.
 * Caps at 1080p — we render to 1080x1920, so anything larger is wasted
 * bandwidth and decode time.
 */
export async function download(url, workDir, { log = () => {}, maxHeight = 1080 } = {}) {
  const dir = ensureDir(path.join(workDir, 'download'));

  const { out: titleOut } = await run(PY, ['-m', 'yt_dlp', '--no-playlist', '--print', '%(title)s', '--skip-download', url]);
  const title = titleOut.trim().split('\n').pop() || 'video';
  log(`  "${title}"`);

  await run(
    PY,
    [
      '-m', 'yt_dlp',
      '--no-playlist',
      '--no-progress',
      '-f', `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/bv*+ba/b`,
      '--merge-output-format', 'mp4',
      // yt-dlp needs ffmpeg to mux separate video/audio streams; reuse the
      // copy ClipForge already ships instead of requiring one on PATH.
      '--ffmpeg-location', path.dirname(paths.ffmpeg),
      '-o', path.join(dir, 'source.%(ext)s'),
      url,
    ],
    { quiet: true }
  );

  const files = readdirSync(dir).filter((f) => /\.(mp4|mkv|webm|mov)$/i.test(f));
  if (!files.length) throw new Error(`yt-dlp produced no video file in ${dir}`);
  const file = path.join(dir, files[0]);
  if (!existsSync(file)) throw new Error(`Downloaded file vanished: ${file}`);
  return { file, title };
}
