import { z } from 'zod';
import { decryptSecret } from '@/lib/crypto';
import { channelRefreshToken, enqueueVideo, existingJobVideoIds, getDashboard, sourceChannelForTenant } from '@/lib/repository';
import { tenantIdFromSession } from '@/lib/session';
import type { PastVideo, StoredSourceChannel } from '@/lib/types';
import { latestTwitchVods } from '@/lib/twitch';
import { refreshGoogleAccessToken, youtubePastVideos } from '@/lib/youtube';

async function sourceCatalog(source: StoredSourceChannel): Promise<PastVideo[]> {
  if (source.platform === 'twitch') return latestTwitchVods(source.platformUserId, 30);
  const encrypted = await channelRefreshToken(source.destinationChannelId);
  if (!encrypted) throw new Error('Reconnect the destination YouTube channel before browsing past videos.');
  const accessToken = await refreshGoogleAccessToken(decryptSecret(encrypted));
  return youtubePastVideos(accessToken, source.platformUserId, 30);
}

export async function GET(request: Request) {
  try {
    const tenantId = await tenantIdFromSession();
    const sourceId = z.string().min(1).parse(new URL(request.url).searchParams.get('sourceId'));
    const source = await sourceChannelForTenant(tenantId, sourceId);
    if (!source) return Response.json({ error: 'Source channel not found.' }, { status: 404 });
    const [videos, queuedIds] = await Promise.all([sourceCatalog(source), existingJobVideoIds(tenantId)]);
    const queued = new Set(queuedIds);
    return Response.json({ source: { id: source.id, title: source.title, platform: source.platform }, videos: videos.map((video) => ({ ...video, alreadyQueued: queued.has(video.id) })) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Past videos could not be loaded.' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await tenantIdFromSession();
    const { sourceId, videoIds } = z.object({ sourceId: z.string().min(1), videoIds: z.array(z.string().min(1)).min(1).max(20) }).parse(await request.json());
    const source = await sourceChannelForTenant(tenantId, sourceId);
    if (!source) return Response.json({ error: 'Source channel not found.' }, { status: 404 });
    const [catalog, queuedIds] = await Promise.all([sourceCatalog(source), existingJobVideoIds(tenantId)]);
    const catalogById = new Map(catalog.map((video) => [video.id, video]));
    const alreadyQueued = new Set(queuedIds);
    const uniqueIds = [...new Set(videoIds)];
    const invalidIds = uniqueIds.filter((id) => !catalogById.has(id));
    if (invalidIds.length) return Response.json({ error: 'One or more selected videos do not belong to this source.' }, { status: 400 });
    const selected = uniqueIds.filter((id) => !alreadyQueued.has(id)).map((id) => catalogById.get(id)!);
    for (const video of selected) await enqueueVideo(source, video);
    return Response.json({ ok: true, queued: selected.length, skipped: uniqueIds.length - selected.length, dashboard: await getDashboard(tenantId) });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : 'Videos could not be queued.';
    return Response.json({ error: message }, { status: 400 });
  }
}
