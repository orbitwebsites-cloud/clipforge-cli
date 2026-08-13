import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const FILE = path.join(ROOT, 'work', 'queue.json');
const LOCK = path.join(ROOT, 'work', 'queue.lock');

function ensureWork() {
  mkdirSync(path.join(ROOT, 'work'), { recursive: true });
}

export function load() {
  ensureWork();
  if (!existsSync(FILE)) return { items: [] };
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return { items: [] };
  }
}

export function save(state) {
  ensureWork();
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}

/**
 * Cheap advisory lock. Scheduled runs can overlap if one upload runs long, and
 * two processes posting from the same queue would double-post the same clip.
 * Stale locks older than 30 min are ignored — a crashed run should not wedge
 * the schedule permanently.
 */
export function acquireLock() {
  ensureWork();
  if (existsSync(LOCK)) {
    const age = Date.now() - statSync(LOCK).mtimeMs;
    if (age < 30 * 60_000) return false;
  }
  writeFileSync(LOCK, String(process.pid));
  return true;
}

export function releaseLock() {
  try {
    if (existsSync(LOCK)) unlinkSync(LOCK);
  } catch {
    /* best effort */
  }
}

const cleanTitle = (file) => path.basename(file, '.mp4').replace(/\s*\(9x16\)$/, '');

/** Add every mp4 in a directory (or one file) to the queue, skipping duplicates. */
export function addPath(target, meta = {}) {
  const abs = path.resolve(target);
  if (!existsSync(abs)) throw new Error(`No such path: ${abs}`);
  const isDirectory = statSync(abs).isDirectory();
  const files = isDirectory
    ? readdirSync(abs).filter((f) => f.toLowerCase().endsWith('.mp4')).map((f) => path.join(abs, f))
    : [abs];

  // Agent renders use numbered slug filenames for stable ordering, while
  // clips.json contains the human title chosen by the evaluator. Preserve the
  // evaluated title in YouTube instead of publishing "01-some-file-slug".
  const manifestTitles = new Map();
  const manifestFile = isDirectory ? path.join(abs, 'clips.json') : null;
  if (manifestFile && existsSync(manifestFile)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      for (const clip of manifest.clips || []) {
        if (clip?.name && clip?.title) manifestTitles.set(String(clip.name), String(clip.title));
      }
    } catch {
      // A malformed optional manifest should not block otherwise valid files.
    }
  }

  const state = load();
  const known = new Set(state.items.map((i) => i.file));
  let added = 0;
  for (const file of files) {
    if (known.has(file)) continue;
    state.items.push({
      file,
      title: manifestTitles.get(path.basename(file)) || cleanTitle(file),
      source: meta.source || null,
      tags: meta.tags || null,
      status: 'pending',
      addedAt: new Date().toISOString(),
    });
    added++;
  }
  save(state);
  return { added, skipped: files.length - added, total: state.items.length };
}

export function nextPending() {
  const state = load();
  // Oldest first, and skip anything whose file has since been deleted.
  return state.items.find((i) => i.status === 'pending' && existsSync(i.file)) || null;
}

export function markPosted(file, result) {
  const state = load();
  const item = state.items.find((i) => i.file === file);
  if (item) {
    item.status = 'posted';
    item.videoId = result.id;
    item.url = result.shortUrl;
    item.privacyStatus = result.privacyStatus;
    item.postedAt = new Date().toISOString();
  }
  save(state);
}

export function markFailed(file, message) {
  const state = load();
  const item = state.items.find((i) => i.file === file);
  if (item) {
    item.attempts = (item.attempts || 0) + 1;
    item.lastError = message.slice(0, 300);
    item.lastTriedAt = new Date().toISOString();
    // Leave status 'pending' so a daily-limit failure retries on the next slot,
    // but give up after repeated hard failures so it cannot block the queue.
    if (item.attempts >= 5) item.status = 'failed';
  }
  save(state);
}

export function summary() {
  const { items } = load();
  const by = (s) => items.filter((i) => i.status === s).length;
  return { pending: by('pending'), posted: by('posted'), failed: by('failed'), total: items.length };
}

export function list() {
  return load().items;
}
