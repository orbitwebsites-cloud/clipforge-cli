/**
 * YouTube Analytics integration.
 *
 * The youtube.js OAuth flow already requests the yt-analytics.readonly scope,
 * so no re-auth is needed — this module just uses the same access token to
 * query the Analytics API.
 *
 * Primary use: build a "performance brief" string that the analyze.js map pass
 * receives as context. When the LLM knows that "ambush clips average 900 views
 * while build-reveal clips average 200", it picks better moments.
 *
 * Secondary use: prioritize the pending queue so the watcher's highest-potential
 * clips post first rather than strictly FIFO.
 */

import { accessToken } from './youtube.js';

const ANALYTICS_BASE = 'https://youtubeanalytics.googleapis.com/v2';

/**
 * Fetch view / like / retention stats for a list of video IDs.
 * Returns a Map<videoId, { views, likes, avgViewPct }>
 */
export async function fetchVideoStats(videoIds, { log = () => {} } = {}) {
  if (!videoIds.length) return new Map();
  const tok = await accessToken();

  // YouTube Data API v3 for views + likes (Analytics API can't batch by video)
  const dataUrl =
    'https://www.googleapis.com/youtube/v3/videos?part=statistics&id=' +
    encodeURIComponent(videoIds.join(',')) +
    '&maxResults=50';
  const dataRes = await fetch(dataUrl, { headers: { Authorization: `Bearer ${tok}` } });
  const dataJson = await dataRes.json();
  if (dataJson.error) {
    log(`  ! YouTube Data API: ${dataJson.error.message}`);
    return new Map();
  }

  const out = new Map();
  for (const item of dataJson.items || []) {
    out.set(item.id, {
      views: Number(item.statistics?.viewCount || 0),
      likes: Number(item.statistics?.likeCount || 0),
      avgViewPct: null, // populated below if Analytics responds
    });
  }

  // Analytics API for average view percentage (one call per video is expensive;
  // skip if the account has < 5 videos with data — early channels lack history).
  if (out.size >= 5) {
    for (const [vid, stat] of out) {
      try {
        const aUrl =
          `${ANALYTICS_BASE}/reports?ids=channel%3D%3DMINE` +
          `&startDate=2020-01-01&endDate=2099-01-01` +
          `&metrics=averageViewPercentage` +
          `&filters=video%3D%3D${vid}`;
        const aRes = await fetch(aUrl, { headers: { Authorization: `Bearer ${tok}` } });
        const aJson = await aRes.json();
        const rows = aJson.rows || [];
        if (rows.length) stat.avgViewPct = Number(rows[0][0]).toFixed(1);
      } catch {
        // skip per-video analytics on error; views/likes still useful
      }
    }
  }

  return out;
}

/**
 * Build a brief paragraph the LLM can use as context for clip selection.
 *
 * Example output:
 *   "Top clip: 'Cookie's Shack Destroyed' — 1560 views, 28 likes, 62% retention.
 *    Weak clip: 'Pofa Chase Ends in Arrest' — 2 views, 0 likes.
 *    Avg views (top 3): 1127. Channel is early; patterns are suggestive only."
 */
export function buildPerformanceBrief(stats, postedItems) {
  if (!stats.size) return '';

  const enriched = postedItems
    .filter((i) => stats.has(i.videoId))
    .map((i) => ({ ...i, ...stats.get(i.videoId) }))
    .sort((a, b) => b.views - a.views);

  if (!enriched.length) return '';

  const top = enriched.slice(0, 3);
  const bottom = enriched.filter((e) => e.views < 10);
  const avgTop = Math.round(top.reduce((s, e) => s + e.views, 0) / top.length);

  const lines = [
    `Top clip: "${top[0].title}" — ${top[0].views} views, ${top[0].likes} likes` +
      (top[0].avgViewPct ? `, ${top[0].avgViewPct}% retention` : '') + '.',
  ];
  if (top[1]) lines.push(`Runner-up: "${top[1].title}" — ${top[1].views} views.`);
  if (bottom.length) {
    lines.push(
      `Avoid: clips similar to "${bottom[0].title}" (${bottom[0].views} views).`
    );
  }
  lines.push(`Avg top-3: ${avgTop} views.`);
  if (enriched.length < 10) lines.push('Channel is early; patterns are suggestive only.');

  return lines.join(' ');
}
