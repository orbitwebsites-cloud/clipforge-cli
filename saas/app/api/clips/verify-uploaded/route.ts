import { getDashboard } from '@/lib/repository';
import { query } from '@/lib/db';
import { tenantIdFromSession } from '@/lib/session';
import { refreshGoogleAccessToken } from '@/lib/youtube';
import { decryptSecret } from '@/lib/crypto';

const YT_VIDEOS = 'https://www.googleapis.com/youtube/v3/videos';

export async function GET() {
  try {
    const tenantId = await tenantIdFromSession();
    const dashboard = await getDashboard(tenantId);

    // All clips ClipForge believes it uploaded
    const { rows: tracked } = await query<{
      id: string;
      youtube_video_id: string;
      title: string;
      channel_id: string;
      created_at: string;
    }>(
      `SELECT c.id, c.youtube_video_id, c.title, j.channel_id, c.created_at
       FROM clips c
       JOIN jobs j ON j.id = c.job_id
       WHERE j.tenant_id = $1
         AND c.youtube_video_id IS NOT NULL
         AND c.status IN ('uploaded', 'deleted')
       ORDER BY c.created_at DESC
       LIMIT 200`,
      [tenantId],
    );

    // Clips with status=uploaded but no youtube_video_id (upload tracking gaps)
    const { rows: untracked } = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM clips c
       JOIN jobs j ON j.id = c.job_id
       WHERE j.tenant_id = $1
         AND c.status = 'uploaded'
         AND c.youtube_video_id IS NULL`,
      [tenantId],
    );
    const untrackedCount = Number(untracked[0]?.count ?? 0);

    if (!tracked.length) {
      return Response.json({
        ok: true,
        trackedCount: 0,
        untrackedCount,
        confirmedOnYouTube: 0,
        missingOnYouTube: 0,
        accuracyPercent: 100,
        missing: [],
      });
    }

    // Get access token for YouTube API verification (refresh_token is encrypted at rest)
    const channelId = tracked[0].channel_id;
    const { rows: channelRows } = await query<{ refresh_token_encrypted: string }>(
      `SELECT refresh_token_encrypted FROM channels WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [channelId, tenantId],
    );
    const encrypted = channelRows[0]?.refresh_token_encrypted;
    if (!encrypted) {
      return Response.json({ ok: false, error: 'No connected YouTube channel — cannot verify.' }, { status: 400 });
    }
    let accessToken: string;
    try {
      accessToken = await refreshGoogleAccessToken(decryptSecret(encrypted));
    } catch {
      return Response.json({ ok: false, error: 'YouTube auth for this channel has expired or was revoked.' }, { status: 400 });
    }

    // Batch verify in chunks of 50 (YouTube API limit)
    const CHUNK = 50;
    const confirmedIds = new Set<string>();
    for (let i = 0; i < tracked.length; i += CHUNK) {
      const chunk = tracked.slice(i, i + CHUNK).map((r) => r.youtube_video_id);
      const url = `${YT_VIDEOS}?part=id&id=${chunk.join(',')}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const body = await res.json() as { items?: { id: string }[] };
      for (const item of body.items ?? []) confirmedIds.add(item.id);
    }

    const missing = tracked.filter((r) => !confirmedIds.has(r.youtube_video_id));
    const confirmedCount = tracked.length - missing.length;
    const accuracyPercent = Math.round((confirmedCount / tracked.length) * 10000) / 100;

    return Response.json({
      ok: true,
      trackedCount: tracked.length,
      untrackedCount,
      confirmedOnYouTube: confirmedCount,
      missingOnYouTube: missing.length,
      accuracyPercent,
      missing: missing.map((r) => ({
        clipId: r.id,
        youtubeVideoId: r.youtube_video_id,
        title: r.title,
        createdAt: r.created_at,
      })),
      dashboard: { plan: dashboard.tenant.plan },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification failed';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
