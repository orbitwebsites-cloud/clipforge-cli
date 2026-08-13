import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

/**
 * YouTube Data API daily quota tracker.
 *
 * Since June 2026, videos.insert has its own granular quota bucket. The
 * default allowance is 100 calls/day and each upload costs one call. It resets
 * at midnight Pacific — NOT local midnight — which catches people out.
 * Tracking locally lets a batch stop before burning calls that will 403.
 */
const COST_INSERT = 1;
const DAILY_UNITS = Number(process.env.YT_DAILY_UPLOADS || 100);
const FILE = path.join(ROOT, 'work', 'quota.json');

/** Current date in US/Pacific as YYYY-MM-DD — the quota reset boundary. */
export function pacificDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function load() {
  if (!existsSync(FILE)) return { day: pacificDay(), used: 0 };
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8'));
    // A stored day that is not today means the quota has since reset.
    if (data.day !== pacificDay()) return { day: pacificDay(), used: 0 };
    // Migrate counters written under the pre-June 2026 quota model, where each
    // successful upload was recorded as 1600 units.
    if (data.used > 100) return { ...data, used: Math.floor(data.used / 1600) };
    return data;
  } catch {
    return { day: pacificDay(), used: 0 };
  }
}

function save(state) {
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}

export function remainingUploads() {
  const { used } = load();
  return Math.max(0, Math.floor((DAILY_UNITS - used) / COST_INSERT));
}

export function recordUpload() {
  const state = load();
  state.used += COST_INSERT;
  save(state);
  return state;
}

export function quotaStatus() {
  const { day, used } = load();
  return { day, used, limit: DAILY_UNITS, remainingUploads: remainingUploads() };
}
