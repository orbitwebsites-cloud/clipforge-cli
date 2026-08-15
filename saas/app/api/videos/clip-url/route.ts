import { createHash } from 'node:crypto';
import { z } from 'zod';
import { destinationChannelForTenant, enqueueVideo, getDashboard } from '@/lib/repository';
import { tenantIdFromSession } from '@/lib/session';
import { youtubeVideoIdFromUrl } from '@/lib/youtube-identity';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']);

// YouTube links can point at someone else's channel, so those still require
// the rights checkbox. A direct link (Dropbox, Drive, a raw file URL, ...) is
// something the user already holds themselves, so it skips that gate.
const schema = z.object({
  url: z.string().trim().min(1, 'Paste a video link.').max(500),
  rightsConfirmed: z.boolean().optional(),
});

function titleFromUrl(url: URL) {
  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
  const withoutExt = last.replace(/\.[a-z0-9]{2,5}$/i, '');
  return withoutExt || 'Uploaded video';
}

export async function POST(request: Request) {
  try {
    const tenantId = await tenantIdFromSession();
    const { url: rawUrl, rightsConfirmed } = schema.parse(await request.json());

    let parsed: URL;
    try {
      parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
    } catch {
      return Response.json({ error: 'Enter a valid video link.' }, { status: 400 });
    }

    const channelId = await destinationChannelForTenant(tenantId);
    if (!channelId) return Response.json({ error: 'Connect a destination YouTube channel first.' }, { status: 400 });

    const isYouTube = YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase());

    if (isYouTube) {
      if (rightsConfirmed !== true) {
        return Response.json({ error: 'Confirm that you own or have permission to repurpose this video.' }, { status: 400 });
      }
      const videoId = youtubeVideoIdFromUrl(parsed);
      if (!videoId) return Response.json({ error: 'That looks like a channel link, not a video. Paste a specific video URL.' }, { status: 400 });

      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const oembed = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`, { cache: 'no-store' });
      if (!oembed.ok) return Response.json({ error: 'Could not load that video — check the link and try again.' }, { status: 400 });
      const meta = await oembed.json() as { title?: string };

      await enqueueVideo({ tenantId, destinationChannelId: channelId }, { id: videoId, title: meta.title || 'YouTube video', url: watchUrl }, 'backfill');
    } else {
      // Direct/public links (Dropbox, Google Drive share links, raw file URLs, ...) —
      // the worker's yt-dlp already handles these hosts natively at download time.
      const syntheticId = `link_${createHash('sha256').update(parsed.toString()).digest('hex').slice(0, 24)}`;
      await enqueueVideo({ tenantId, destinationChannelId: channelId }, { id: syntheticId, title: titleFromUrl(parsed), url: parsed.toString() }, 'backfill');
    }

    return Response.json({ ok: true, dashboard: await getDashboard(tenantId) });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : 'Video could not be queued.';
    return Response.json({ error: message }, { status: 400 });
  }
}
