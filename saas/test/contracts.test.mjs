import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { channelIdFromChannelHtml, channelIdFromVideoHtml, youtubeVideoIdFromUrl } from '../lib/youtube-identity.ts';

test('YouTube identity extraction ignores unrelated recommendation channels', () => {
  const unrelated = 'UCPLMPHT-d8GZOqL_AHJFdQQ';
  const actual = 'UCk2uxbWi5py_iJXaEsh2YRA';
  const channelHtml = `<script>{"channelId":"${unrelated}"}</script><link rel="canonical" href="https://www.youtube.com/channel/${actual}">`;
  const videoHtml = `<script>{"channelId":"${unrelated}","videoDetails":{"videoId":"abc123","channelId":"${actual}"}}</script>`;
  assert.equal(channelIdFromChannelHtml(channelHtml), actual);
  assert.equal(channelIdFromVideoHtml(videoHtml), actual);
  assert.equal(youtubeVideoIdFromUrl(new URL('https://youtu.be/abc123')), 'abc123');
  assert.equal(youtubeVideoIdFromUrl(new URL('https://youtube.com/shorts/abc123')), 'abc123');
  assert.equal(youtubeVideoIdFromUrl(new URL('https://youtube.com/live/abc123')), 'abc123');
});

test('database enforces idempotent source-video jobs', () => {
  const sql = readFileSync(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8');
  assert.match(sql, /unique \(tenant_id, source_video_id\)/i);
});

test('worker keeps creator-controlled duration and caption formats without synthetic voiceover', () => {
  const worker = readFileSync(new URL('../worker/clip-worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /preferences\.minClipSeconds/);
  assert.match(worker, /preferences\.maxClipSeconds/);
  assert.match(worker, /captions: true/);
  assert.match(worker, /captionStyle\(preferences\)/);
  assert.match(worker, /listen\(port, '0\.0\.0\.0'/);
  assert.doesNotMatch(worker, /voiceover|narration/i);
});

test('creator control center supports review-first publishing and analytics learning', () => {
  const migration = readFileSync(new URL('../migrations/007_creator_control.sql', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../app/api/settings/route.ts', import.meta.url), 'utf8');
  const publish = readFileSync(new URL('../app/api/clips/publish/route.ts', import.meta.url), 'utf8');
  const repository = readFileSync(new URL('../lib/repository.ts', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../worker/clip-worker.mjs', import.meta.url), 'utf8');
  assert.match(migration, /creator_preferences/);
  assert.match(migration, /rights_confirmed/);
  assert.match(migration, /privacy_status/);
  assert.match(settings, /updateCreatorPreferences/);
  assert.match(publish, /publishYouTubeVideo/);
  assert.match(repository, /performance_data/);
  assert.match(worker, /performanceBrief\(job\)/);
  assert.match(worker, /requestedPrivacy/);
});

test('new source additions require an explicit rights confirmation', () => {
  const route = readFileSync(new URL('../app/api/channels/route.ts', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../app/dashboard/dashboard.tsx', import.meta.url), 'utf8');
  assert.match(route, /rightsConfirmed/);
  assert.match(route, /z\.literal\(true/);
  assert.match(dashboard, /I own or have permission to repurpose this source/);
});

test('OAuth requests offline upload access', () => {
  const route = readFileSync(new URL('../app/api/auth/youtube/start/route.ts', import.meta.url), 'utf8');
  const youtube = readFileSync(new URL('../lib/youtube.ts', import.meta.url), 'utf8');
  assert.match(route, /access_type: 'offline'/);
  assert.match(youtube, /youtube\.upload/);
  assert.match(youtube, /openid/);
  assert.match(youtube, /yt-analytics\.readonly/);
});

test('dashboard monitors decision-ready YouTube analytics with a quota cache', () => {
  const analytics = readFileSync(new URL('../lib/analytics.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../app/api/analytics/route.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../migrations/005_channel_analytics.sql', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../app/dashboard/dashboard.tsx', import.meta.url), 'utf8');
  assert.match(analytics, /estimatedMinutesWatched/);
  assert.match(analytics, /averageViewDuration/);
  assert.match(analytics, /subscribersGained/);
  assert.match(analytics, /dimensions: 'video'/);
  assert.match(route, /tenantIdFromSession/);
  assert.match(route, /cachedChannelAnalytics/);
  assert.match(migration, /channel_analytics_snapshots/);
  assert.match(dashboard, /7, 28, 90/);
  assert.match(dashboard, /Short performance/);
});

test('Clerk provisions the account before destination YouTube OAuth', () => {
  const session = readFileSync(new URL('../lib/session.ts', import.meta.url), 'utf8');
  const repository = readFileSync(new URL('../lib/repository.ts', import.meta.url), 'utf8');
  const start = readFileSync(new URL('../app/api/auth/youtube/start/route.ts', import.meta.url), 'utf8');
  const callback = readFileSync(new URL('../app/api/auth/youtube/callback/route.ts', import.meta.url), 'utf8');
  const isolation = readFileSync(new URL('../migrations/006_tenant_identity_isolation.sql', import.meta.url), 'utf8');
  assert.match(session, /currentUser/);
  assert.match(session, /ensureTenant/);
  assert.match(start, /ensureCurrentTenant/);
  assert.match(callback, /saveConnectedChannel/);
  assert.match(callback, /tenantIdFromSession/);
  assert.match(callback, /state\.tenantId !== activeTenantId/);
  assert.match(repository, /on conflict \(id\)/i);
  assert.doesNotMatch(repository, /on conflict \(email\)/i);
  assert.doesNotMatch(repository, /tenant\.id === id \|\| tenant\.email/);
  assert.match(isolation, /drop constraint if exists tenants_email_key/);
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

test('free, creator, and clipping plan limits are enforced by the backend', () => {
  const repository = readFileSync(new URL('../lib/repository.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../migrations/003_plan_limits.sql', import.meta.url), 'utf8');
  const clipping = readFileSync(new URL('../migrations/008_clipping_plan.sql', import.meta.url), 'utf8');
  assert.match(repository, /source_channel_limit/);
  assert.match(repository, /monthly_clip_limit/);
  assert.match(migration, /monthly_clip_limit=10/);
  assert.match(migration, /source_channel_limit=5/);
  assert.match(migration, /complimentary_creator/);
  assert.match(clipping, /'clipping'/);
  assert.match(clipping, /source_channel_limit=15/);
});

test('Creator jobs receive priority queueing and truthful three-hour positioning', () => {
  const repository = readFileSync(new URL('../lib/repository.ts', import.meta.url), 'utf8');
  const landing = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(repository, /t\.plan in \('creator','clipping','studio'\)/);
  assert.match(repository, /plan === 'free' \? 1440 : 180/);
  assert.match(landing, /Priority queue with 3-hour target/);
  assert.match(landing, /150 published or review-ready Shorts monthly/);
});

test('annual Creator checkout saves $68 and domain migration preserves Google OAuth', () => {
  const checkout = readFileSync(new URL('../app/api/billing/checkout/route.ts', import.meta.url), 'utf8');
  const youtube = readFileSync(new URL('../lib/youtube.ts', import.meta.url), 'utf8');
  const landing = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(checkout, /WHOP_CREATOR_ANNUAL_CHECKOUT_URL/);
  assert.match(checkout, /billingCycle/);
  assert.match(youtube, /GOOGLE_OAUTH_REDIRECT_URI/);
  assert.match(landing, /\$520\/year/);
  assert.match(landing, /Save \$68/);
});

test('Clipping tier has a real $89 checkout and 15-source positioning', () => {
  const checkout = readFileSync(new URL('../app/api/billing/checkout/route.ts', import.meta.url), 'utf8');
  const webhook = readFileSync(new URL('../app/api/billing/webhook/route.ts', import.meta.url), 'utf8');
  const landing = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../app/dashboard/dashboard.tsx', import.meta.url), 'utf8');
  assert.match(checkout, /WHOP_CLIPPING_CHECKOUT_URL/);
  assert.match(checkout, /'clipping'/);
  assert.match(webhook, /\$4='clipping' then 15/);
  assert.match(landing, /\$89/);
  assert.match(landing, /15 continuously monitored/);
  assert.match(dashboard, /\$89/);
  assert.match(dashboard, /Upgrade to Clipping/);
});

test('dashboard navigation uses focused URL-backed tabs with a full centered profile', () => {
  const dashboard = readFileSync(new URL('../app/dashboard/dashboard.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(dashboard, /type DashboardTab/);
  assert.match(dashboard, /url\.searchParams\.set\('tab', tab\)/);
  assert.match(dashboard, /activeTab === 'analytics'/);
  assert.match(dashboard, /activeTab === 'jobs'/);
  assert.match(dashboard, /activeTab === 'clips'/);
  assert.match(dashboard, /activeTab === 'sources'/);
  assert.match(dashboard, /activeTab === 'profile'/);
  assert.match(dashboard, /activeTab === 'settings'/);
  assert.match(dashboard, /<UserProfile routing="hash"/);
  assert.match(styles, /\.profile-page\{display:grid;place-items:center/);
  assert.match(styles, /\.mobile-tabs/);
});

test('jobs survive refresh and stay synchronized with persisted live dashboard data', () => {
  const page = readFileSync(new URL('../app/dashboard/page.tsx', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../app/api/dashboard/route.ts', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../app/dashboard/dashboard.tsx', import.meta.url), 'utf8');
  const repository = readFileSync(new URL('../lib/repository.ts', import.meta.url), 'utf8');
  assert.match(page, /revalidate = 0/);
  assert.match(page, /initialTab/);
  assert.match(page, /searchParams/);
  assert.match(route, /force-dynamic/);
  assert.match(route, /private, no-store, max-age=0/);
  assert.match(repository, /select \* from jobs where tenant_id=\$1 order by detected_at desc limit 50/);
  assert.match(dashboard, /fetch\('\/api\/dashboard'/);
  assert.match(dashboard, /cache: 'no-store'/);
  assert.match(dashboard, /window\.setInterval/);
  assert.match(dashboard, /visibilitychange/);
  assert.match(dashboard, /requestController\.signal/);
  assert.match(dashboard, /Reconnecting/);
});

test('billing makes upgrade and cancellation equally discoverable', () => {
  const dashboard = readFileSync(new URL('../app/dashboard/dashboard.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /upgrade-nav/);
  assert.match(dashboard, /Upgrade plan/);
  assert.match(dashboard, /Manage or cancel subscription/);
  assert.match(dashboard, /whop\.com\/@me\/settings\/orders/);
  assert.match(dashboard, /no email or\s+support ticket required/);
});

test('owner accounts receive lifetime complimentary Clipping without checkout', () => {
  const repository = readFileSync(new URL('../lib/repository.ts', import.meta.url), 'utf8');
  const webhook = readFileSync(new URL('../app/api/billing/webhook/route.ts', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../app/dashboard/dashboard.tsx', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../migrations/009_complimentary_clipping_accounts.sql', import.meta.url), 'utf8');
  assert.match(repository, /complimentary \? 'clipping'/);
  assert.match(repository, /complimentary \? 15 : 1/);
  assert.match(webhook, /complimentary_creator then 'clipping'/);
  assert.match(dashboard, /Lifetime access · \$0/);
  assert.match(dashboard, /data\.tenant\.complimentaryCreator\s*\|\|\s*\[\s*'clipping',\s*'studio',?\s*\]/);
  assert.match(migration, /rrus3676@gmail\.com/);
  assert.match(migration, /orbitboyzz@gmail\.com/);
  assert.match(migration, /source_channel_limit=15/);
});

test('users can selectively backfill past videos from multiple owned sources into one normal publishing batch', () => {
  const route = readFileSync(new URL('../app/api/videos/backfill/route.ts', import.meta.url), 'utf8');
  const youtube = readFileSync(new URL('../lib/youtube.ts', import.meta.url), 'utf8');
  const twitch = readFileSync(new URL('../lib/twitch.ts', import.meta.url), 'utf8');
  const repository = readFileSync(new URL('../lib/repository.ts', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../app/dashboard/dashboard.tsx', import.meta.url), 'utf8');
  assert.match(route, /tenantIdFromSession/);
  assert.match(route, /sourceChannelForTenant/);
  assert.match(route, /sourceIds/);
  assert.match(route, /selections: z\.array/);
  assert.match(route, /videoIds: z\.array/);
  assert.match(route, /\.max\(20\)/);
  assert.match(route, /maximum of 20 videos per batch/);
  assert.match(route, /do not belong to their source channel/);
  assert.match(route, /accessTokenByDestination/);
  assert.match(route, /Promise\.all\(sources\.map/);
  assert.match(route, /enqueueVideo/);
  assert.match(route, /alreadyQueued/);
  assert.match(youtube, /relatedPlaylists\?\.uploads/);
  assert.match(youtube, /youtube\/v3\/playlistItems/);
  assert.match(twitch, /Math\.min\(100/);
  assert.match(repository, /select \* from source_channels where id=\$1 and tenant_id=\$2/);
  assert.match(dashboard, /Select source channels/);
  assert.match(dashboard, /librarySourceIds/);
  assert.match(dashboard, /data\.sourceChannels\.map\(\(source\) => source\.id\)/);
  assert.match(dashboard, /knownLibrarySourceIds/);
  assert.match(dashboard, /JSON\.stringify\(\{ selections \}\)/);
  assert.match(dashboard, /cross-channel batch/);
  assert.match(dashboard, /const videoRounds = useMemo/);
  assert.match(dashboard, /creatorVideos\.flatMap/);
  assert.match(dashboard, /Latest from every creator/);
  assert.match(dashboard, /Second-latest from every creator/);
  assert.match(dashboard, /Analyze and post this batch/);
  assert.match(dashboard, /Confirm &amp; open jobs/);
  assert.match(dashboard, /onOpenJobs\(\)/);
  assert.match(dashboard, /Analyze &amp; post selected/);
  assert.match(dashboard, /maximum 20\s+per batch/);
});

test('source input accepts handles and reports duplicate channels clearly', () => {
  const youtube = readFileSync(new URL('../lib/youtube.ts', import.meta.url), 'utf8');
  const identity = readFileSync(new URL('../lib/youtube-identity.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../app/api/channels/route.ts', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../app/dashboard/dashboard.tsx', import.meta.url), 'utf8');
  assert.match(youtube, /normalizeYouTubeChannelInput/);
  assert.match(youtube, /input\.startsWith\('@'\)/);
  assert.match(youtube, /youtubeVideoIdFromUrl/);
  assert.match(youtube, /youtube\.com\/oembed/);
  assert.match(identity, /rel="canonical"/);
  assert.match(identity, /channelMetadataRenderer/);
  assert.doesNotMatch(youtube, /html\.match\(\/"channelId"/);
  assert.match(route, /alreadyConnected/);
  assert.match(route, /is already connected/);
  assert.match(dashboard, /body\.message/);
});

test('Twitch sources use official Helix, signed EventSub, and VOD polling fallback', () => {
  const twitch = readFileSync(new URL('../lib/twitch.ts', import.meta.url), 'utf8');
  const webhook = readFileSync(new URL('../app/api/webhooks/twitch/route.ts', import.meta.url), 'utf8');
  const poll = readFileSync(new URL('../app/api/cron/poll-youtube/route.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../migrations/004_multiplatform_sources.sql', import.meta.url), 'utf8');
  assert.match(twitch, /api\.twitch\.tv\/helix/);
  assert.match(twitch, /stream\.offline/);
  assert.match(twitch, /videos\?id=/);
  assert.match(webhook, /createHmac\('sha256'/);
  assert.match(webhook, /timingSafeEqual/);
  assert.match(poll, /latestTwitchVods/);
  assert.match(migration, /platform in \('youtube','twitch'\)/);
});
