import { timingSafeEqual } from 'node:crypto';
import { enqueueVideo, markSourceChannelPolled, monitoredSourceChannels } from '@/lib/repository';
import { parseYouTubeAtomEntries, subscribeWebSub } from '@/lib/youtube';

function authorized(request: Request) {
  const expected = Buffer.from(process.env.CRON_SECRET || '');
  const actual = Buffer.from(request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '');
  return expected.length > 20 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const channels = await monitoredSourceChannels();
  let discovered = 0;
  const failures: Array<{ channel: string; error: string }> = [];
  for (const channel of channels) {
    try {
      const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channel.youtubeChannelId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Feed returned ${response.status}`);
      for (const event of parseYouTubeAtomEntries(await response.text()).slice(0, 5)) {
        if (event.publishedAt && new Date(event.publishedAt).getTime() < new Date(channel.createdAt).getTime() - 5 * 60000) continue;
        await enqueueVideo(channel, event); discovered++;
      }
      await markSourceChannelPolled(channel.id);
      await subscribeWebSub(channel);
    } catch (error) { failures.push({ channel: channel.youtubeChannelId, error: error instanceof Error ? error.message : String(error) }); }
  }
  return Response.json({ ok: failures.length === 0, channels: channels.length, eventsReviewed: discovered, failures });
}
