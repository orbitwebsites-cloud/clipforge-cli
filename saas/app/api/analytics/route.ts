import { decryptSecret } from '@/lib/crypto';
import { loadYouTubeAnalytics } from '@/lib/analytics';
import { analyticsChannelForTenant, cachedChannelAnalytics, getDashboard, saveChannelAnalytics } from '@/lib/repository';
import { tenantIdFromSession } from '@/lib/session';
import { refreshGoogleAccessToken } from '@/lib/youtube';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const tenantId = await tenantIdFromSession();
    const url = new URL(request.url);
    const requestedRange = Number(url.searchParams.get('range') || 28);
    const rangeDays = ([7, 28, 90].includes(requestedRange) ? requestedRange : 28) as 7 | 28 | 90;
    const channel = await analyticsChannelForTenant(tenantId);
    if (!channel) return Response.json({ error: 'Connect a destination YouTube channel first.' }, { status: 404 });
    if (url.searchParams.get('refresh') !== '1') {
      const cached = await cachedChannelAnalytics(channel.id, rangeDays);
      if (cached) return Response.json(cached);
    }
    if (!channel.refreshTokenEncrypted || channel.refreshTokenEncrypted === 'demo') {
      throw new Error('Reconnect your destination channel to enable YouTube Analytics.');
    }
    const accessToken = await refreshGoogleAccessToken(decryptSecret(channel.refreshTokenEncrypted));
    const analytics = await loadYouTubeAnalytics(accessToken, await getDashboard(tenantId), rangeDays);
    await saveChannelAnalytics(channel.id, rangeDays, analytics);
    return Response.json(analytics);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analytics are unavailable';
    return Response.json({ error: message }, { status: message.includes('authenticated') ? 401 : 502 });
  }
}
