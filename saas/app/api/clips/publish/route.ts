import { z } from 'zod';
import { decryptSecret } from '@/lib/crypto';
import { channelRefreshToken, markClipPublished, reviewClipForTenant } from '@/lib/repository';
import { tenantIdFromSession } from '@/lib/session';
import { publishYouTubeVideo, refreshGoogleAccessToken } from '@/lib/youtube';

export async function POST(request: Request) {
  try {
    const tenantId = await tenantIdFromSession();
    const { clipId } = z.object({ clipId: z.string().min(1) }).parse(await request.json());
    const clip = await reviewClipForTenant(tenantId, clipId);
    if (!clip?.youtube_video_id) throw new Error('Private review clip not found');
    const encrypted = await channelRefreshToken(clip.channel_id);
    if (!encrypted) throw new Error('Reconnect YouTube before publishing');
    const accessToken = await refreshGoogleAccessToken(decryptSecret(encrypted));
    await publishYouTubeVideo(accessToken, clip.youtube_video_id);
    await markClipPublished(tenantId, clipId);
    return Response.json({ ok: true, youtubeUrl: clip.youtube_url });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Short could not be published' }, { status: 400 });
  }
}
