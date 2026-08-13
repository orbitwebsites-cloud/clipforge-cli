import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { run, ensureDir } from './ffmpeg.js';

const PY = process.env.CFC_PYTHON || 'python';
const SEEN_FILE = path.join(ensureDir(paths.work), 'seen-videos.json');

function loadSeen() {
  if (!existsSync(SEEN_FILE)) return new Set();
  try { return new Set(JSON.parse(readFileSync(SEEN_FILE, 'utf8'))); }
  catch { return new Set(); }
}

function saveSeen(set) {
  writeFileSync(SEEN_FILE, JSON.stringify([...set]));
}

/**
 * Fetch the most-recent `limit` videos from a channel URL.
 * Returns entries: { id, url, title, uploadDate }
 * Does NOT filter against seen — caller does that so the set stays consistent.
 */
async function fetchRecent(channelUrl, limit) {
  const { out } = await run(
    PY,
    [
      '-m', 'yt_dlp',
      '--flat-playlist',
      '--playlist-items', `1:${limit}`,
      '--print', '%(id)s\t%(webpage_url)s\t%(title)s\t%(upload_date)s',
      '--no-warnings',
      '--quiet',
      '--skip-download',
      channelUrl,
    ],
    { quiet: true }
  );
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [id, url, title, uploadDate] = line.split('\t');
      return { id: id?.trim(), url: url?.trim(), title: title?.trim(), uploadDate: uploadDate?.trim() };
    })
    .filter((v) => v.id && v.url);
}

/**
 * Poll all configured channels and return videos not yet in the seen set.
 * Marks each found video as seen immediately so concurrent runs don't double-process.
 */
export async function discoverNew(channels, { limit = 5, maxVideos = Infinity, log = () => {} } = {}) {
  const seen = loadSeen();
  const fresh = [];

  for (const ch of channels) {
    const label = ch.name || ch.url;
    log(`  checking ${label}`);
    try {
      const recent = await fetchRecent(ch.url, limit);
      const newOnes = recent.filter((v) => !seen.has(v.id));
      for (const v of newOnes) fresh.push({ ...v, channel: label });
      log(`    ${recent.length} fetched, ${newOnes.length} new`);
    } catch (err) {
      log(`  ! ${label}: ${err.message.split('\n')[0]}`);
    }
  }

  const selected = fresh.slice(0, Math.max(0, maxVideos));
  for (const v of selected) seen.add(v.id);
  if (selected.length) saveSeen(seen);
  return selected;
}
