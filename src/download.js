import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { run, ensureDir } from './ffmpeg.js';

const PY = process.env.CFC_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const YTDLP_RUNTIME_ARGS = ['--js-runtimes', `node:${process.execPath}`];
const potServerHome = process.env.CFC_YTDLP_POT_SERVER_HOME;
if (potServerHome) {
  YTDLP_RUNTIME_ARGS.push('--extractor-args', `youtubepot-bgutilscript:server_home=${potServerHome}`);
  YTDLP_RUNTIME_ARGS.push('--extractor-args', 'youtube:player-client=mweb');
}

/**
 * Browser to lift YouTube cookies from, or `none` to send none.
 *
 * Without cookies YouTube answers downloads with "Sign in to confirm you're not
 * a bot" — discovery still works (flat-playlist is a cheaper endpoint), so the
 * failure shows up only at download time and looks like a yt-dlp crash.
 *
 * The POT-token path above is the other fix, but it needs a bgutil server that
 * is not installed here; cookies need nothing. Firefox is the default because
 * Chrome and Edge on Windows encrypt their cookie store with app-bound DPAPI,
 * which yt-dlp cannot read (yt-dlp#10927).
 */
const cookiesFile = process.env.CFC_YTDLP_COOKIES_FILE;
// A configured POT server already gets past the bot check without cookies, so
// only fall back to the (desktop-only) browser-cookie default when neither a
// cookies file nor a POT server is set — headless hosts have no browser profile
// to read and crash instead of downloading ("could not find firefox cookies database").
const cookieBrowser = (process.env.CFC_YTDLP_COOKIES || (potServerHome ? 'none' : 'firefox')).trim();
if (cookiesFile) {
  YTDLP_RUNTIME_ARGS.push('--cookies', cookiesFile);
} else if (cookieBrowser && cookieBrowser !== 'none') {
  YTDLP_RUNTIME_ARGS.push('--cookies-from-browser', cookieBrowser);
}

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
  const format = potServerHome
    ? `b[height<=${maxHeight}][vcodec!=none][acodec!=none]/b[vcodec!=none][acodec!=none]`
    : `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/bv*+ba/b`;

  const { out: titleOut } = await run(PY, ['-m', 'yt_dlp', ...YTDLP_RUNTIME_ARGS, '--no-playlist', '--print', '%(title)s', '--skip-download', url]);
  const title = titleOut.trim().split('\n').pop() || 'video';
  log(`  "${title}"`);

  // A prior network attempt may have completed the source before the wrapper
  // was interrupted. Reuse a valid merged file so retries do not redownload
  // multi-gigabyte videos from scratch.
  const cached = path.join(dir, 'source.mp4');
  if (existsSync(cached)) {
    log('  reusing cached source.mp4');
    return { file: cached, title };
  }

  await run(
    PY,
    [
      '-m', 'yt_dlp', ...YTDLP_RUNTIME_ARGS,
      '--no-playlist',
      '--no-progress',
      '-f', format,
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
