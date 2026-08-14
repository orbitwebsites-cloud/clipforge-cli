import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync, mkdirSync, unlinkSync } from 'node:fs';
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
  const raw = readFileSync(FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    // Never swallow this. Returning an empty queue here looks like a fresh
    // install, so the next addPath rebuilds the file with no record of what
    // was already posted — and every one of those videos gets re-uploaded.
    // Fail loudly instead and let a human pick a backup.
    throw new Error(
      `queue.json is corrupt (${err.message}). Refusing to continue — a blank `
      + `queue would re-upload everything already posted. Restore one of the `
      + `work/queue.backup-*.json files, then re-run.`
    );
  }
}

/**
 * Atomic write: a torn queue.json is unrecoverable, so never write in place.
 * Same-directory rename is atomic on NTFS, so a crash leaves either the whole
 * old file or the whole new one.
 */
export function save(state) {
  ensureWork();
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, FILE);
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
    unlinkSync(LOCK); // stale — the run that owned it died
  }
  try {
    // 'wx' makes create-if-absent a single atomic syscall. Without it, two
    // slots that overlap can both pass the existsSync check above and both
    // believe they hold the lock.
    writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false; // someone else won the race
  }
}

export function releaseLock() {
  try {
    if (!existsSync(LOCK)) return;
    // Only delete a lock we actually own. If a long run went stale and another
    // slot took over, unlinking unconditionally would strip the new owner's
    // lock and let a third process in alongside it.
    if (readFileSync(LOCK, 'utf8').trim() !== String(process.pid)) return;
    unlinkSync(LOCK);
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
      priority: Number(meta.priority || 0),
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
  // Publishing priority: Unstable SMP first, Lifesteal second, everything else
  // last. Preserve queue order (oldest first) within each category.
  const rank = (item) => {
    const tags = String(item.tags || '').toLowerCase().split(',').map((tag) => tag.trim());
    if (tags.includes('unstablesmp')) return 1;
    if (tags.includes('lifesteal') || tags.includes('lifestealsmp')) return 2;
    return 3;
  };
  return state.items
    .map((item, index) => ({ item, index }))
    // 'uploading' is deliberately excluded: an item stuck there was interrupted
    // mid-PUT and may already be live on YouTube. Re-posting it blind would
    // duplicate it, so it needs a human to confirm before it moves again.
    .filter(({ item }) => item.status === 'pending' && existsSync(item.file))
    .sort((a, b) =>
      Number(b.item.priority || 0) - Number(a.item.priority || 0)
      || rank(a.item) - rank(b.item)
      || a.index - b.index
    )[0]?.item || null;
}

/**
 * Record that bytes are about to go to YouTube. Task Scheduler force-kills a
 * run at its 30 min ExecutionTimeLimit, which skips every finally block — so
 * if the kill lands after YouTube accepts the upload but before markPosted,
 * the item would still read 'pending' and the next slot would post it twice.
 * Stamping 'uploading' first means the interrupted item is visibly in-flight
 * rather than silently eligible again.
 */
export function markUploading(file) {
  const state = load();
  const item = state.items.find((i) => i.file === file);
  if (item) {
    item.status = 'uploading';
    item.uploadStartedAt = new Date().toISOString();
  }
  save(state);
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
    // Clear the transient upload-cap message, otherwise `cfc queue` keeps
    // printing "Channel upload limit reached" beside a video that posted fine.
    delete item.lastError;
  }
  save(state);
}

export function markFailed(file, message, { retryable = false } = {}) {
  const state = load();
  const item = state.items.find((i) => i.file === file);
  if (item) {
    if (!retryable) item.attempts = (item.attempts || 0) + 1;
    item.lastError = message.slice(0, 300);
    item.lastTriedAt = new Date().toISOString();
    // The upload never started transferring, so release the 'uploading' stamp
    // markUploading set. Without this every upload-cap rejection would leave
    // the item in-flight forever and the queue would drain to nothing.
    if (item.status === 'uploading') {
      item.status = 'pending';
      delete item.uploadStartedAt;
    }
    // Expected daily ceilings stay pending indefinitely; only repeated hard
    // failures age out so one broken file cannot block the queue forever.
    if (!retryable && item.attempts >= 5) item.status = 'failed';
  }
  save(state);
}

export function summary() {
  const { items } = load();
  const by = (s) => items.filter((i) => i.status === s).length;
  return {
    pending: by('pending'),
    posted: by('posted'),
    failed: by('failed'),
    uploading: by('uploading'),
    total: items.length,
  };
}

export function list() {
  return load().items;
}
