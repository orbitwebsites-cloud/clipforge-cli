import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('database enforces idempotent source-video jobs', () => {
  const sql = readFileSync(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8');
  assert.match(sql, /unique \(tenant_id, source_video_id\)/i);
});

test('worker keeps the proven clip duration and caption format', () => {
  const worker = readFileSync(new URL('../worker/clip-worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /min: 15, max: 32/);
  assert.match(worker, /captions: true/);
  assert.match(worker, /listen\(port, '0\.0\.0\.0'/);
  assert.doesNotMatch(worker, /voiceover|narration/i);
});

test('OAuth requests offline upload access', () => {
  const route = readFileSync(new URL('../app/api/auth/youtube/start/route.ts', import.meta.url), 'utf8');
  const youtube = readFileSync(new URL('../lib/youtube.ts', import.meta.url), 'utf8');
  assert.match(route, /access_type: 'offline'/);
  assert.match(youtube, /youtube\.upload/);
  assert.match(youtube, /openid/);
});

test('Clerk provisions the account before destination YouTube OAuth', () => {
  const session = readFileSync(new URL('../lib/session.ts', import.meta.url), 'utf8');
  const callback = readFileSync(new URL('../app/api/auth/youtube/callback/route.ts', import.meta.url), 'utf8');
  assert.match(session, /currentUser/);
  assert.match(session, /ensureTenant/);
  assert.match(callback, /saveConnectedChannel/);
  assert.doesNotMatch(callback, /clipforge_session/);
});

test('YouTube webhook is authenticated and idempotently enqueued', () => {
  const route = readFileSync(new URL('../app/api/webhooks/youtube/route.ts', import.meta.url), 'utf8');
  assert.match(route, /webhookSourceChannel/);
  assert.match(route, /enqueueVideo/);
});

test('source channels are independent, many-per-tenant inputs', () => {
  const sql = readFileSync(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../app/api/channels/route.ts', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists source_channels/i);
  assert.match(sql, /destination_channel_id/i);
  assert.match(route, /addSourceChannel/);
  assert.match(route, /export async function DELETE/);
});

test('fallback poll is signed and renews WebSub subscriptions', () => {
  const route = readFileSync(new URL('../app/api/cron/poll-youtube/route.ts', import.meta.url), 'utf8');
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /subscribeWebSub/);
  assert.match(route, /enqueueVideo/);
});

test('dashboard repository strips OAuth and webhook secrets', () => {
  const repository = readFileSync(new URL('../lib/repository.ts', import.meta.url), 'utf8');
  assert.match(repository, /publicChannel/);
  assert.match(repository, /_webhookSecret/);
  assert.match(repository, /_refreshToken/);
});

test('free and creator plan limits are enforced by the backend', () => {
  const repository = readFileSync(new URL('../lib/repository.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../migrations/003_plan_limits.sql', import.meta.url), 'utf8');
  assert.match(repository, /source_channel_limit/);
  assert.match(repository, /monthly_clip_limit/);
  assert.match(migration, /monthly_clip_limit=10/);
  assert.match(migration, /source_channel_limit=5/);
  assert.match(migration, /complimentary_creator/);
});

test('Creator jobs receive priority queueing and truthful three-hour positioning', () => {
  const repository = readFileSync(new URL('../lib/repository.ts', import.meta.url), 'utf8');
  const landing = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(repository, /t\.plan in \('creator','studio'\)/);
  assert.match(repository, /plan === 'free' \? 1440 : 180/);
  assert.match(landing, /Priority queue with 3-hour target/);
  assert.match(landing, /150 published Shorts monthly/);
});
