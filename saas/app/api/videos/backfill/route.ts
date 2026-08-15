import { z } from 'zod';
import { decryptSecret } from '@/lib/crypto';
import { channelRefreshToken, enqueueVideo, existingJobVideoIds, getDashboard, sourceChannelForTenant } from '@/lib/repository';
import { tenantIdFromSession } from '@/lib/session';
import type { PastVideo, StoredSourceChannel } from '@/lib/types';
import { latestTwitchVods } from '@/lib/twitch';
import { refreshGoogleAccessToken, youtubePastVideos } from '@/lib/youtube';

const selectionSchema = z.object({
  sourceId: z.string().min(1),
  videoIds: z.array(z.string().min(1)).min(1).max(20),
});

const backfillSchema = z.union([
  z.object({ selections: z.array(selectionSchema).min(1).max(15) }).superRefine(({ selections }, context) => {
    if (selections.reduce((total, selection) => total + selection.videoIds.length, 0) > 20) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose a maximum of 20 videos per batch.', path: ['selections'] });
    }
  }),
  selectionSchema,
]);

function createSourceCatalogLoader() {
  const accessTokenByDestination = new Map<string, Promise<string>>();

  return async (source: StoredSourceChannel): Promise<PastVideo[]> => {
    if (source.platform === 'twitch') return latestTwitchVods(source.platformUserId, 30);

    let accessToken = accessTokenByDestination.get(source.destinationChannelId);
    if (!accessToken) {
      accessToken = (async () => {
        const encrypted = await channelRefreshToken(source.destinationChannelId);
        if (!encrypted) throw new Error('Reconnect the destination YouTube channel before browsing past videos.');
        return refreshGoogleAccessToken(decryptSecret(encrypted));
      })();
      accessTokenByDestination.set(source.destinationChannelId, accessToken);
    }

    return youtubePastVideos(await accessToken, source.platformUserId, 30);
  };
}

async function sourcesForTenant(tenantId: string, sourceIds: string[]) {
  const uniqueIds = [...new Set(sourceIds)];
  const sources = await Promise.all(uniqueIds.map((sourceId) => sourceChannelForTenant(tenantId, sourceId)));
  if (sources.some((source) => !source)) return null;
  return sources as StoredSourceChannel[];
}

function normalizeSelections(input: unknown) {
  const parsed = backfillSchema.parse(input);
  const entries = 'selections' in parsed ? parsed.selections : [parsed];
  const bySource = new Map<string, Set<string>>();

  for (const entry of entries) {
    const videoIds = bySource.get(entry.sourceId) || new Set<string>();
    entry.videoIds.forEach((videoId) => videoIds.add(videoId));
    bySource.set(entry.sourceId, videoIds);
  }

  return [...bySource].map(([sourceId, videoIds]) => ({ sourceId, videoIds: [...videoIds] }));
}

export async function GET(request: Request) {
  try {
    const tenantId = await tenantIdFromSession();
    const searchParams = new URL(request.url).searchParams;
    const rawSourceIds = searchParams.get('sourceIds') || searchParams.get('sourceId') || '';
    const sourceIds = z.array(z.string().min(1)).min(1).max(15).parse(rawSourceIds.split(',').filter(Boolean));
    const sources = await sourcesForTenant(tenantId, sourceIds);
    if (!sources) return Response.json({ error: 'One or more source channels were not found.' }, { status: 404 });

    const loadCatalog = createSourceCatalogLoader();
    const [catalogs, queuedIds] = await Promise.all([
      Promise.all(sources.map(async (source) => ({ source, videos: await loadCatalog(source) }))),
      existingJobVideoIds(tenantId),
    ]);
    const queued = new Set(queuedIds);
    const videos = catalogs.flatMap(({ source, videos: sourceVideos }) => sourceVideos.map((video) => ({
      ...video,
      sourceId: source.id,
      sourceTitle: source.title,
      alreadyQueued: queued.has(video.id),
    })));

    return Response.json({
      sources: sources.map((source) => ({ id: source.id, title: source.title, platform: source.platform })),
      videos,
    });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : 'Past videos could not be loaded.';
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await tenantIdFromSession();
    const selections = normalizeSelections(await request.json());
    const sources = await sourcesForTenant(tenantId, selections.map(({ sourceId }) => sourceId));
    if (!sources) return Response.json({ error: 'One or more source channels were not found.' }, { status: 404 });

    const loadCatalog = createSourceCatalogLoader();
    const [catalogs, queuedIds] = await Promise.all([
      Promise.all(sources.map(async (source) => ({ source, videos: await loadCatalog(source) }))),
      existingJobVideoIds(tenantId),
    ]);
    const catalogBySource = new Map(catalogs.map(({ source, videos }) => [source.id, new Map(videos.map((video) => [video.id, video]))]));
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const alreadyQueued = new Set(queuedIds);
    const selected: Array<{ source: StoredSourceChannel; video: PastVideo }> = [];
    let requested = 0;

    for (const selection of selections) {
      const source = sourceById.get(selection.sourceId)!;
      const catalog = catalogBySource.get(selection.sourceId)!;
      requested += selection.videoIds.length;
      if (selection.videoIds.some((videoId) => !catalog.has(videoId))) {
        return Response.json({ error: 'One or more selected videos do not belong to their source channel.' }, { status: 400 });
      }

      for (const videoId of selection.videoIds) {
        if (alreadyQueued.has(videoId)) continue;
        selected.push({ source, video: catalog.get(videoId)! });
        alreadyQueued.add(videoId);
      }
    }

    for (const { source, video } of selected) await enqueueVideo(source, video, 'backfill');
    return Response.json({ ok: true, queued: selected.length, skipped: requested - selected.length, dashboard: await getDashboard(tenantId) });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : 'Videos could not be queued.';
    return Response.json({ error: message }, { status: 400 });
  }
}
