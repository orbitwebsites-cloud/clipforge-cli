import { getDashboard } from '@/lib/repository';
import { query } from '@/lib/db';
import { tenantIdFromSession } from '@/lib/session';
import { refreshGoogleAccessToken } from '@/lib/youtube';
import { decryptSecret } from '@/lib/crypto';

const YT_VIDEOS = 'https://www.googleapis.com/youtube/v3/videos';

async function fetchViewCounts(videoIds: string[], accessToken: string): Promise<Map<string, number>> {
  const url = `${YT_VIDEOS}?part=statistics&id=${videoIds.join(',')}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.json() as { items?: { id: string; statistics?: { viewCount?: string } }[] };
  const map = new Map<string, number>();
  for (const item of body.items ?? []) {
    map.set(item.id, Number(item.statistics?.viewCount ?? 0));
  }
  return map;
}

async function deleteYouTubeVideo(videoId: string, accessToken: string): Promise<boolean> {
  const res = await fetch(`${YT_VIDEOS}?id=${encodeURIComponent(videoId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.status === 204;
}

export async function POST(request: Request) {
  try {
    const tenantId = await tenantIdFromSession();
    const dashboard = await getDashboard(tenantId);
    const prefs = dashboard.preferences;

    if (!prefs.autoDeleteEnabled) {
      return Response.json({ ok: true, deleted: 0, message: 'Auto-delete is disabled.' });
    }

    const body = await request.json().catch(() => ({})) as { minViews?: number; hours?: number };
    const minViews = body.minViews ?? prefs.autoDeleteMinViews;
    const hours = body.hours ?? prefs.autoDeleteAfterHours;
    const cutoffDate = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // CRITICAL: only select clips ClipForge uploaded — must have youtube_video_id
    const { rows: candidates } = await query<{ id: string; youtube_video_id: string; channel_id: string }>(
      `SELECT c.id, c.youtube_video_id, j.channel_id
       FROM clips c
       JOIN jobs j ON j.id = c.job_id
       WHERE j.tenant_id = $1
         AND c.status = 'uploaded'
         AND c.youtube_video_id IS NOT NULL
         AND c.created_at < $2`,
      [tenantId, cutoffDate],
    );

    if (!candidates.length) {
      return Response.json({ ok: true, deleted: 0, message: 'No eligible clips found.' });
    }

    // Fetch per-channel access tokens (refresh_token is encrypted at rest; exchange it for a live access token)
    const channelIds = [...new Set(candidates.map((r) => r.channel_id))];
    const tokenMap = new Map<string, string>();
    for (const channelId of channelIds) {
      const { rows } = await query<{ refresh_token_encrypted: string }>(
        `SELECT refresh_token_encrypted FROM channels WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [channelId, tenantId],
      );
      const encrypted = rows[0]?.refresh_token_encrypted;
      if (!encrypted) continue;
      try {
        const accessToken = await refreshGoogleAccessToken(decryptSecret(encrypted));
        tokenMap.set(channelId, accessToken);
      } catch {
        // Channel's Google auth is broken/revoked — skip it rather than fail the whole batch
      }
    }

    const anyToken = [...tokenMap.values()][0];
    if (!anyToken) {
      return Response.json({ ok: false, error: 'No connected YouTube channel found.' }, { status: 400 });
    }

    const videoIds = candidates.map((r) => r.youtube_video_id);
    const viewCounts = await fetchViewCounts(videoIds, anyToken);

    const toDelete = candidates.filter((r) => (viewCounts.get(r.youtube_video_id) ?? 0) < minViews);
    const deleted: string[] = [];
    const errors: string[] = [];

    for (const clip of toDelete) {
      const token = tokenMap.get(clip.channel_id) ?? anyToken;
      const success = await deleteYouTubeVideo(clip.youtube_video_id, token);
      if (success) {
        await query(`UPDATE clips SET status = 'deleted' WHERE id = $1`, [clip.id]);
        deleted.push(clip.id);
      } else {
        errors.push(clip.youtube_video_id);
      }
    }

    return Response.json({ ok: true, deleted: deleted.length, deletedIds: deleted, errors });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Auto-delete failed';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
