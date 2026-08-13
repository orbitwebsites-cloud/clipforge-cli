import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { accessToken } from '../src/youtube.js';

const END_DATE = process.argv[2] || new Date().toISOString().slice(0, 10);
const START_DATE = '2000-01-01';
const OUT_DIR = path.resolve('work', 'analytics');
const OUT_FILE = path.join(OUT_DIR, `youtube-${END_DATE}.json`);

const token = await accessToken();
const headers = { Authorization: `Bearer ${token}` };

async function getJson(url, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(url, { headers });
    const body = await response.json();
    if (response.ok) return body;
    if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      continue;
    }
    throw new Error(`${response.status} ${body.error?.message || response.statusText}`);
  }
}

function analyticsQuery(params) {
  const query = new URLSearchParams({
    ids: 'channel==MINE',
    startDate: START_DATE,
    endDate: END_DATE,
    ...params,
  });
  return getJson(`https://youtubeanalytics.googleapis.com/v2/reports?${query}`);
}

function rowsAsObjects(report) {
  const names = (report.columnHeaders || []).map((column) => column.name);
  return (report.rows || []).map((row) => Object.fromEntries(names.map((name, i) => [name, row[i]])));
}

async function concurrentMap(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

const channelResponse = await getJson(
  'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true'
);
const channel = channelResponse.items?.[0];

const performanceReport = await analyticsQuery({
  dimensions: 'video',
  metrics:
    'views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost',
  sort: '-views',
  maxResults: '200',
});
const performance = rowsAsObjects(performanceReport);
const videoIds = performance.map((row) => row.video);

const metadata = [];
for (let offset = 0; offset < videoIds.length; offset += 50) {
  const ids = videoIds.slice(offset, offset + 50).join(',');
  const query = new URLSearchParams({
    part: 'snippet,contentDetails,statistics,status',
    id: ids,
    maxResults: '50',
  });
  const response = await getJson(`https://www.googleapis.com/youtube/v3/videos?${query}`);
  metadata.push(...(response.items || []));
}
const metadataById = Object.fromEntries(metadata.map((video) => [video.id, video]));

const details = await concurrentMap(videoIds, 8, async (videoId, index) => {
  process.stdout.write(`\rCollecting video ${index + 1}/${videoIds.length}`);
  const [trafficResult, retentionResult] = await Promise.allSettled([
    analyticsQuery({
      dimensions: 'insightTrafficSourceType',
      filters: `video==${videoId}`,
      metrics: 'views,estimatedMinutesWatched',
      sort: '-views',
      maxResults: '100',
    }),
    analyticsQuery({
      dimensions: 'elapsedVideoTimeRatio',
      filters: `video==${videoId}`,
      metrics: 'audienceWatchRatio,relativeRetentionPerformance',
      sort: 'elapsedVideoTimeRatio',
      maxResults: '200',
    }),
  ]);
  return {
    videoId,
    traffic:
      trafficResult.status === 'fulfilled' ? rowsAsObjects(trafficResult.value) : [],
    trafficError:
      trafficResult.status === 'rejected' ? trafficResult.reason.message : null,
    retention:
      retentionResult.status === 'fulfilled' ? rowsAsObjects(retentionResult.value) : [],
    retentionError:
      retentionResult.status === 'rejected' ? retentionResult.reason.message : null,
  };
});
process.stdout.write('\n');

const dailyReport = await analyticsQuery({
  dimensions: 'day',
  metrics:
    'views,engagedViews,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost',
  sort: 'day',
  maxResults: '1000',
});

const payload = {
  generatedAt: new Date().toISOString(),
  window: { startDate: START_DATE, endDate: END_DATE },
  channel: channel
    ? {
        id: channel.id,
        title: channel.snippet.title,
        publishedAt: channel.snippet.publishedAt,
        statistics: channel.statistics,
      }
    : null,
  metricDefinitions: Object.fromEntries(
    performanceReport.columnHeaders.map((column) => [column.name, column])
  ),
  performance,
  metadataById,
  detailsById: Object.fromEntries(details.map((detail) => [detail.videoId, detail])),
  daily: rowsAsObjects(dailyReport),
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
console.log(`Saved ${videoIds.length} viewed videos to ${OUT_FILE}`);
