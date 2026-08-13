import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const snapshotFile = path.join(root, 'work', 'analytics', 'youtube-2026-08-12.json');
const outputDir = path.join(root, 'reports', 'youtube-strategy-2026-08-12');
const raw = JSON.parse(readFileSync(snapshotFile, 'utf8'));

const isoSeconds = (value = 'PT0S') => {
  const m = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0;
};
const median = (values) => {
  const a = [...values].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};
const round = (n, digits = 1) => Number(n.toFixed(digits));
const metadata = raw.metadataById || {};

const videos = raw.performance.map((p) => {
  const meta = metadata[p.video] || {};
  const duration = isoSeconds(meta.contentDetails?.duration);
  const traffic = raw.detailsById?.[p.video]?.traffic || [];
  const shortsViews = traffic.find((r) => r.insightTrafficSourceType === 'SHORTS')?.views || 0;
  return {
    video_id: p.video,
    title: meta.snippet?.title || p.video,
    published_at: meta.snippet?.publishedAt || null,
    duration_seconds: duration,
    views: p.views,
    engaged_views: p.engagedViews,
    engaged_view_rate: p.views ? p.engagedViews / p.views : 0,
    average_view_percentage: p.averageViewPercentage,
    average_view_duration_seconds: p.averageViewDuration,
    likes: p.likes,
    like_rate: p.views ? p.likes / p.views : 0,
    comments: p.comments,
    shares: p.shares,
    net_subscribers: p.subscribersGained - p.subscribersLost,
    shorts_feed_share: p.views ? shortsViews / p.views : 0,
    youtube_url: `https://youtube.com/shorts/${p.video}`,
  };
}).filter((v) => v.views > 0).sort((a, b) => b.views - a.views);

const durationBins = [
  { label: '15–20s', test: (n) => n <= 20 },
  { label: '21–35s', test: (n) => n >= 21 && n <= 35 },
  { label: '36–50s', test: (n) => n >= 36 && n <= 50 },
  { label: '51–70s', test: (n) => n >= 51 && n <= 70 },
  { label: '>70s', test: (n) => n > 70 },
].map(({ label, test }) => {
  const rows = videos.filter((v) => test(v.duration_seconds));
  const totalViews = rows.reduce((s, v) => s + v.views, 0);
  const totalEngaged = rows.reduce((s, v) => s + v.engaged_views, 0);
  return {
    duration_bin: label,
    video_count: rows.length,
    total_views: totalViews,
    median_views: round(median(rows.map((v) => v.views)) || 0),
    engaged_view_rate: totalViews ? totalEngaged / totalViews : 0,
    median_average_view_percentage: round(median(rows.map((v) => v.average_view_percentage)) || 0),
  };
});

const retentionVideos = [
  ['EOWsWdnOKZ8', 'Invisible-player ambush'],
  ['WjiaWeLThYM', 'Connect Four showdown'],
  ['byKTwlS2qpo', 'Justice / rejected reveal'],
  ['qkmJwKKiFC4', 'Static revenge control'],
];
const retention = retentionVideos.flatMap(([id, series]) =>
  (raw.detailsById?.[id]?.retention || []).map((r) => ({
    video_id: id,
    series,
    progress_percent: round(r.elapsedVideoTimeRatio * 100, 0),
    audience_watch_ratio: r.audienceWatchRatio,
    relative_retention_performance: r.relativeRetentionPerformance,
    views: videos.find((v) => v.video_id === id)?.views || 0,
  }))
);

const totalMeasuredViews = videos.reduce((s, v) => s + v.views, 0);
const totalEngaged = videos.reduce((s, v) => s + v.engaged_views, 0);
const totalLikes = videos.reduce((s, v) => s + v.likes, 0);
const netSubscribers = videos.reduce((s, v) => s + v.net_subscribers, 0);
const top5Views = videos.slice(0, 5).reduce((s, v) => s + v.views, 0);
const summary = [{
  channel_lifetime_views: Number(raw.channel.statistics.viewCount),
  current_videos_measured: videos.length,
  current_video_views: totalMeasuredViews,
  engaged_views: totalEngaged,
  likes: totalLikes,
  net_subscribers: netSubscribers,
  channel_subscribers: Number(raw.channel.statistics.subscriberCount),
  top_5_view_share: top5Views / totalMeasuredViews,
  measured_view_coverage: totalMeasuredViews / Number(raw.channel.statistics.viewCount),
}];

const generatedAt = raw.generatedAt;
const analyticsSource = {
  id: 'youtube_analytics_snapshot',
  label: 'YouTube Analytics API v2 snapshot',
  href: 'https://developers.google.com/youtube/analytics',
  query: {
    engine: 'youtube-analytics-api-v2',
    language: 'http',
    sql: `SELECT
  video, views, engagedViews, averageViewDuration,
  averageViewPercentage, likes, comments, shares,
  subscribersGained, subscribersLost
FROM youtube_analytics.reports_query
WHERE ids = 'channel==MINE'
  AND startDate = DATE '2005-02-14'
  AND endDate = DATE '2026-08-12'`,
    description: 'Lifetime per-video performance for current videos returned by the authenticated A TON OF CLIPS channel.',
    id: 'channel-lifetime-video-performance-2026-08-12',
    url: 'https://developers.google.com/youtube/analytics/reference/reports/query',
    executed_at: generatedAt,
    tables_used: ['YouTube Analytics reports.query'],
    filters: ['Authenticated channel only', 'Lifetime through 2026-08-12', 'Only videos returned by the per-video Analytics report', 'Rows with views > 0 in strategy comparisons'],
    metric_definitions: [
      'Engaged-view rate = engagedViews / views.',
      'Like rate = likes / views.',
      'Top-5 view share = views on the five highest-view current videos / all measured current-video views.',
      'Audience watch ratio may exceed 1.0 when viewers replay a portion.',
    ],
  },
};
const visualSource = {
  id: 'manual_video_review',
  label: 'Manual visual review of winner and control clips',
  href: 'https://www.youtube.com/@ATONOFCLIPS1088/shorts',
  query: {
    engine: 'manual-review',
    language: 'visual-inspection',
    query: 'Reviewed full clips and frame contact sheets for the top five videos, a timely-news outlier, and two low-view static revenge controls.',
    description: 'Visual audit of hook timing, motion, caption density, story progression, and payoff.',
    id: 'winner-control-visual-audit-2026-08-12',
    executed_at: generatedAt,
    filters: ['Top-view clips plus representative low-view controls', 'No custom voice-over assessment because the production format uses source audio plus captions'],
  },
};

const artifact = {
  surface: 'report',
  manifest: {
    version: 1,
    surface: 'report',
    title: 'A TON OF CLIPS — What Earned Views and What to Make Next',
    description: 'Lifetime channel diagnostic and the production rules now applied to future Minecraft Shorts.',
    generatedAt,
    sources: [analyticsSource, visualSource],
    cards: [
      { id: 'lifetime_views', dataset: 'summary', sourceId: analyticsSource.id, description: 'Public lifetime view count reported by the channel resource.', metrics: [{ label: 'Lifetime channel views', field: 'channel_lifetime_views', format: 'compact' }] },
      { id: 'measured_views', dataset: 'summary', sourceId: analyticsSource.id, description: 'Views attributable to the 55 current videos with at least one returned view.', metrics: [{ label: 'Measured current-video views', field: 'current_video_views', format: 'compact' }] },
      { id: 'top5_share', dataset: 'summary', sourceId: analyticsSource.id, description: 'Share of measured current-video views produced by the five biggest videos.', metrics: [{ label: 'Views from top 5', field: 'top_5_view_share', format: 'percent' }] },
      { id: 'subscribers', dataset: 'summary', sourceId: analyticsSource.id, description: 'Current public subscriber count.', metrics: [{ label: 'Subscribers', field: 'channel_subscribers', format: 'number' }] },
    ],
    charts: [
      {
        id: 'top_videos', title: 'Top current videos by lifetime views', subtitle: 'Four of the five biggest winners are 31 seconds or shorter.', type: 'bar', dataset: 'top_videos', sourceId: analyticsSource.id,
        encodings: { x: { field: 'short_title', type: 'nominal', label: 'Video' }, y: { field: 'views', type: 'quantitative', format: 'compact', label: 'Views' }, tooltip: [{ field: 'duration_seconds', type: 'quantitative', label: 'Duration', unit: 's' }, { field: 'engaged_view_rate', type: 'quantitative', format: 'percent', label: 'Engaged-view rate' }] },
        valueFormat: 'compact', layout: 'full', maxRows: 10,
      },
      {
        id: 'duration_performance', title: 'Median views by video duration', subtitle: 'The 36–50 second template is the largest cohort and the weakest repeatable format.', type: 'bar', dataset: 'duration_bins', sourceId: analyticsSource.id,
        encodings: { x: { field: 'duration_bin', type: 'ordinal', label: 'Duration' }, y: { field: 'median_views', type: 'quantitative', format: 'compact', label: 'Median views' }, tooltip: [{ field: 'video_count', type: 'quantitative', label: 'Videos' }, { field: 'engaged_view_rate', type: 'quantitative', format: 'percent', label: 'Engaged-view rate' }] },
        valueFormat: 'compact', layout: 'full', maxRows: 5,
      },
      {
        id: 'retention_curves', title: 'Audience watch ratio through the video', subtitle: 'The strongest Minecraft stories hold attention deeper into the payoff than the static revenge control.', type: 'line', dataset: 'retention', sourceId: analyticsSource.id,
        encodings: { x: { field: 'progress_percent', type: 'quantitative', label: 'Video progress', unit: '%' }, y: { field: 'audience_watch_ratio', type: 'quantitative', format: 'percent', label: 'Audience watch ratio' }, color: { field: 'series', type: 'nominal', label: 'Video' }, tooltip: [{ field: 'views', type: 'quantitative', format: 'compact', label: 'Views' }] },
        valueFormat: 'percent', layout: 'full', maxRows: 400,
      },
    ],
    blocks: [
      { id: 'title', type: 'markdown', body: '# A TON OF CLIPS — What Earned Views and What to Make Next' },
      { id: 'executive_summary', type: 'markdown', sourceId: analyticsSource.id, body: '## Executive Summary\n\nThe channel has **12.5k lifetime public views**, but only **7.1k** are attributable to current videos returned by the per-video Analytics report. Performance is concentrated: the top five videos generated **68.6%** of measured current-video views. The repeatable Minecraft winners are **15–31 seconds**, begin with an obvious ambush, challenge, rejection, or reveal, and carry the viewer to a visible result. The main volume format—42 videos at 36–50 seconds—has a median of only **11 views**. Future production should focus on short, concrete Minecraft stories with source audio and phrase-level captions only.' },
      { id: 'metrics', type: 'metric-strip', cardIds: ['lifetime_views', 'measured_views', 'top5_share', 'subscribers'] },
      { id: 'findings', type: 'markdown', body: '## Findings\n\nReach did not come from one universal trick. The scalable Minecraft pattern was immediate, visible stakes plus a complete payoff. Celebrity and timely AI-news clips were separate distribution outliers and should not define a Minecraft channel strategy.' },
      { id: 'top_videos_block', type: 'chart', chartId: 'top_videos' },
      { id: 'duration_block', type: 'chart', chartId: 'duration_performance' },
      { id: 'winner_anatomy', type: 'markdown', sourceId: visualSource.id, body: '### Why the winners worked\n\n- **Invisible-player ambush (17s):** action and danger are visible from frame one; the same premise succeeded twice.\n- **Connect Four showdown (31s):** a familiar game creates an instant question, explanatory inserts clarify the strategy, and the result provides a clean payoff.\n- **Justice / rejected reveal (16s):** the opening rejection graphic creates stakes immediately and the story resolves before attention decays.\n- **Caption treatment:** winners use a few bold yellow/white words at a time. The static revenge controls use large paragraph blocks over repetitive backgrounds and provide little visual progression.\n- **Outliers:** iShowSpeed reached the feed because of a famous face despite only 23.3% average viewed; that is not a repeatable Minecraft format.' },
      { id: 'retention_block', type: 'chart', chartId: 'retention_curves' },
      { id: 'strategy', type: 'markdown', body: '## Recommended Next Steps\n\n1. Default every new clip to **15–32 seconds**. Keep a longer clip only when action continuously escalates.\n2. Open on the conflict in the first **1–2 seconds**—ambush, challenge, clutch, betrayal, elimination, surprising rule, or reveal.\n3. Make titles concrete and specific in **3–7 words**; do not use generic revenge phrasing or hashtag stuffing.\n4. Burn in captions as **three-word phrases**, white with a yellow active word. Keep source audio; add no custom voice-over.\n5. Require a visible payoff and reject context-first or static-exposition clips.\n6. Stay Minecraft-only so each successful upload trains the same audience.\n7. Review each new batch after 48 hours and retain formats that combine feed reach with at least ~70% average viewed or ~50% engaged-view rate, using view count as the sample-size guardrail.' },
      { id: 'questions', type: 'markdown', body: '## Further Questions\n\n- Do the five newly posted SB737 clips reproduce the short Minecraft pattern after 48–72 hours?\n- Which source creator consistently provides self-contained ambush, contest, and clutch moments?\n- Does a consistent Minecraft-only run improve returning viewers and subscriber conversion?\n- Can original commentary or permissioned source footage be added later to reduce reused-content monetization risk without weakening retention?' },
      { id: 'caveats', type: 'markdown', sourceId: analyticsSource.id, body: '## Caveats and Assumptions\n\nThe public channel resource reports **12,465** lifetime views, while the per-video Analytics query returned **7,081** views across 58 rows (55 with views). The **5,384-view gap** can include deleted/private/unreturned videos and reporting-definition differences, so the per-video dataset is used for creative comparisons rather than channel accounting. Thirty of 88 public-count videos were absent from the per-video response. Fresh uploads may not appear until Analytics finalizes. Retention and average-view percentages can exceed 100% because of replays; extremely high percentages on very small samples are not treated as proof of a winning format. The >70-second duration bin is confounded by an iShowSpeed celebrity clip and should not be copied.' },
    ],
  },
  snapshot: {
    version: 1,
    generatedAt,
    status: 'ready',
    datasets: {
      summary,
      videos,
      top_videos: videos.slice(0, 10).map((v, i) => ({ ...v, rank: i + 1, short_title: v.title.length > 22 ? `${v.title.slice(0, 19)}…` : v.title })),
      duration_bins: durationBins,
      retention,
    },
  },
  sources: [analyticsSource, visualSource],
};

// Keep the portable reader's report canvas bounded. The full top-video and
// retention data remain in the reviewed snapshot, while the duration chart is
// the decision-driving visual used in the final report.
artifact.manifest.charts = artifact.manifest.charts.filter((chart) => chart.id === 'duration_performance');
artifact.manifest.blocks = artifact.manifest.blocks.filter(
  (block) => !['top_videos_block', 'retention_block'].includes(block.id)
);
mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, 'artifact.json'), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(path.join(outputDir, 'artifact.json'));
