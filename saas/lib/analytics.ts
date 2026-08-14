import type { ChannelAnalytics, DashboardData } from './types';

type Report = {
  columnHeaders?: Array<{ name: string }>;
  rows?: Array<Array<string | number>>;
};

const integer = (value: unknown) => Math.round(Number(value) || 0);
const decimal = (value: unknown) => Number(value) || 0;

function reportRows(report: Report) {
  const names = (report.columnHeaders || []).map((header) => header.name);
  return (report.rows || []).map((row) => Object.fromEntries(names.map((name, index) => [name, row[index]])));
}

async function youtubeReport(accessToken: string, params: Record<string, string>) {
  const query = new URLSearchParams({ ids: 'channel==MINE', ...params });
  const response = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${query}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'YouTube Analytics could not be loaded');
  return body as Report;
}

async function channelTotals(accessToken: string) {
  const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true', {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'YouTube channel totals could not be loaded');
  const statistics = body.items?.[0]?.statistics || {};
  return {
    subscribers: statistics.hiddenSubscriberCount ? null : integer(statistics.subscriberCount),
    lifetimeViews: integer(statistics.viewCount),
    videos: integer(statistics.videoCount),
  };
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateRange(rangeDays: 7 | 28 | 90) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - rangeDays + 1);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

export async function loadYouTubeAnalytics(accessToken: string, dashboard: DashboardData, rangeDays: 7 | 28 | 90): Promise<ChannelAnalytics> {
  const { startDate, endDate } = dateRange(rangeDays);
  const clipMap = new Map(
    dashboard.jobs.flatMap((job) => job.clips)
      .filter((clip) => clip.youtubeVideoId)
      .map((clip) => [clip.youtubeVideoId!, clip]),
  );
  const videoIds = [...clipMap.keys()].slice(-200);
  const common = { startDate, endDate };
  const summaryMetrics = 'views,estimatedMinutesWatched,averageViewDuration,likes,comments,subscribersGained,subscribersLost';
  const [summaryReport, dailyReport, videosReport, totals] = await Promise.all([
    youtubeReport(accessToken, { ...common, metrics: summaryMetrics }),
    youtubeReport(accessToken, { ...common, dimensions: 'day', metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost', sort: 'day' }),
    videoIds.length
      ? youtubeReport(accessToken, { ...common, dimensions: 'video', filters: `video==${videoIds.join(',')}`, metrics: 'views,estimatedMinutesWatched,averageViewDuration,likes,comments,subscribersGained', sort: '-views', maxResults: '200' })
      : Promise.resolve({ rows: [], columnHeaders: [] } as Report),
    channelTotals(accessToken),
  ]);

  const summaryRow = reportRows(summaryReport)[0] || {};
  const views = integer(summaryRow.views);
  const likes = integer(summaryRow.likes);
  const comments = integer(summaryRow.comments);
  const subscribersGained = integer(summaryRow.subscribersGained);
  const subscribersLost = integer(summaryRow.subscribersLost);
  const daily = new Map(reportRows(dailyReport).map((row) => [String(row.day), row]));
  const trend = Array.from({ length: rangeDays }, (_, index) => {
    const date = new Date(`${startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    const key = isoDate(date);
    const row = daily.get(key) || {};
    return { date: key, views: integer(row.views), watchMinutes: decimal(row.estimatedMinutesWatched), subscribersGained: integer(row.subscribersGained), subscribersLost: integer(row.subscribersLost) };
  });
  const shorts = reportRows(videosReport).map((row) => {
    const videoId = String(row.video);
    const clip = clipMap.get(videoId);
    return {
      videoId,
      title: clip?.title || 'Published Short',
      url: clip?.youtubeUrl || `https://youtube.com/shorts/${videoId}`,
      views: integer(row.views),
      watchMinutes: decimal(row.estimatedMinutesWatched),
      averageViewDuration: decimal(row.averageViewDuration),
      likes: integer(row.likes),
      comments: integer(row.comments),
      subscribersGained: integer(row.subscribersGained),
      durationSeconds: clip?.durationSeconds || 0,
    };
  });

  return {
    source: 'youtube', rangeDays, startDate, endDate, syncedAt: new Date().toISOString(),
    summary: {
      views,
      watchMinutes: decimal(summaryRow.estimatedMinutesWatched),
      averageViewDuration: decimal(summaryRow.averageViewDuration),
      likes,
      comments,
      subscribersGained,
      subscribersLost,
      netSubscribers: subscribersGained - subscribersLost,
      engagementRate: views ? Number((((likes + comments) / views) * 100).toFixed(2)) : 0,
    },
    channelTotals: totals,
    trend,
    shorts,
  };
}
