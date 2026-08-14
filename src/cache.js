/**
 * Disk-backed content-addressed cache for expensive pipeline stages.
 *
 * Keys are derived from what would cause a re-computation to produce different
 * output — file identity for transcription, transcript + params for analysis.
 * Atomic write (tmp + rename) so a crash never leaves a half-written entry.
 *
 * Layout: work/cache/<namespace>/<hex-key>.json
 *
 * Namespaces keep transcript and analysis entries from sharing a flat directory
 * and make cache inspection trivial: `ls work/cache/transcript/` shows every
 * file whose transcription has been memoized.
 */

import { createHash } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';

const CACHE_ROOT = path.join(paths.work, 'cache');

function dir(ns) {
  const d = path.join(CACHE_ROOT, ns);
  mkdirSync(d, { recursive: true });
  return d;
}

/**
 * Hash a file by its content. For large audio files (> 50 MB) we only hash the
 * first 4 MB + last 1 MB plus the exact byte length — fast enough to be
 * unnoticeable but still catches any re-encode or trim of the source.
 */
export function fileKey(filePath) {
  const buf = readFileSync(filePath);
  const h = createHash('sha256');
  if (buf.length > 50 * 1024 * 1024) {
    h.update(buf.subarray(0, 4 * 1024 * 1024));
    h.update(buf.subarray(-1 * 1024 * 1024));
    h.update(String(buf.length));
  } else {
    h.update(buf);
  }
  return h.digest('hex').slice(0, 24);
}

/** Hash an arbitrary string (transcript text, JSON params, …). */
export function contentKey(...parts) {
  return createHash('sha256')
    .update(parts.join('\x00'))
    .digest('hex')
    .slice(0, 24);
}

export function get(ns, key) {
  const file = path.join(dir(ns), `${key}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null; // corrupt entry; will be overwritten on next set()
  }
}

export function set(ns, key, data) {
  const d = dir(ns);
  const file = path.join(d, `${key}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, file);
}

/**
 * Evict cache entries older than `maxAgeDays` within a namespace.
 * Called opportunistically at agent startup — never blocks the hot path.
 */
export function evict(ns, maxAgeDays = 30) {
  const d = path.join(CACHE_ROOT, ns);
  if (!existsSync(d)) return 0;
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  let n = 0;
  for (const f of readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(d, f);
    try {
      if (statSync(full).mtimeMs < cutoff) {
        unlinkSync(full);
        n++;
      }
    } catch { /* best effort */ }
  }
  return n;
}

/**
 * Return a human-readable summary of every cache namespace:
 *   { transcript: { entries: 12, bytes: 1024000 }, … }
 */
export function stats() {
  if (!existsSync(CACHE_ROOT)) return {};
  const out = {};
  for (const ns of readdirSync(CACHE_ROOT)) {
    const d = path.join(CACHE_ROOT, ns);
    try {
      if (!statSync(d).isDirectory()) continue;
      let entries = 0;
      let bytes = 0;
      for (const f of readdirSync(d)) {
        if (!f.endsWith('.json')) continue;
        entries++;
        bytes += statSync(path.join(d, f)).size;
      }
      out[ns] = { entries, bytes };
    } catch { /* skip */ }
  }
  return out;
}
