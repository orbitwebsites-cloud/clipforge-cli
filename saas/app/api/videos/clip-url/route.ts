import { z } from 'zod';
import { destinationChannelForTenant, enqueueVideo, getDashboard } from '@/lib/repository';
import { tenantIdFromSession } from '@/lib/session';
import { youtubeVideoIdFromUrl } from '@/lib/youtube-identity';

const schema = z.object({
  url: z.string().trim().min(1, 'Paste a YouTube video link.').max(500),
  rightsConfirmed: z.literal(true, 'Confirm that you own or have permission to repurpose this video.'),
});

export async function POST(request: Request) {
  try {
    const tenantId = await tenantIdFromSession();
    const { url: rawUrl } = schema.parse(await request.json());

    let parsed: URL;
    try {
      parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
    } catch {
      return Response.json({ error: 'Enter a valid YouTube video link.' }, { status: 400 });
    }
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'].includes(parsed.hostname.toLowerCase())) {
      return Response.json({ error: 'Enter a youtube.com or youtu.be video link.' }, { status: 400 });
    }
    const videoId = youtubeVideoIdFromUrl(parsed);
    if (!videoId) return Response.json({ error: 'That looks like a channel link, not a video. Paste a specific video URL.' }, { status: 400 });

    const channelId = await destinationChannelForTenant(tenantId);
    if (!channelId) return Response.json({ error: 'Connect a destination YouTube channel first.' }, { status: 400 });

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const oembed = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`, { cache: 'no-store' });
    if (!oembed.ok) return Response.json({ error: 'Could not load that video — check the link and try again.' }, { status: 400 });
    const meta = await oembed.json() as { title?: string };

    await enqueueVideo({ tenantId, destinationChannelId: channelId }, { id: videoId, title: meta.title || 'YouTube video', url: watchUrl }, 'backfill');
    return Response.json({ ok: true, dashboard: await getDashboard(tenantId) });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : 'Video could not be queued.';
    return Response.json({ error: message }, { status: 400 });
  }
}
