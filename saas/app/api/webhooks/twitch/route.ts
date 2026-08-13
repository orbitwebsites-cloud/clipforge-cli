import { createHmac, timingSafeEqual } from 'node:crypto';
import { enqueueVideo, platformSourceChannels } from '@/lib/repository';
import { latestTwitchVods, twitchEventSubSecret } from '@/lib/twitch';

const header = (request: Request, name: string) => request.headers.get(`twitch-eventsub-${name}`) || '';

export async function POST(request: Request) {
  const rawBody = await request.text();
  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const userId = payload.subscription?.condition?.broadcaster_user_id || payload.event?.broadcaster_user_id;
  if (!userId) return new Response('Missing broadcaster', { status: 400 });
  const messageId = header(request, 'message-id');
  const timestamp = header(request, 'message-timestamp');
  const actual = header(request, 'message-signature');
  if (!messageId || !timestamp || Math.abs(Date.now() - new Date(timestamp).getTime()) > 10 * 60_000) return new Response('Stale request', { status: 403 });
  const expected = `sha256=${createHmac('sha256', twitchEventSubSecret()).update(messageId + timestamp + rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected); const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) return new Response('Invalid signature', { status: 403 });
  const sources = await platformSourceChannels('twitch', userId);
  if (!sources.length) return new Response('Unknown source', { status: 404 });

  const messageType = header(request, 'message-type');
  if (messageType === 'webhook_callback_verification') return new Response(payload.challenge || '', { headers: { 'content-type': 'text/plain' } });
  if (messageType === 'revocation') return new Response('Revocation acknowledged');
  if (messageType !== 'notification' || payload.subscription?.type !== 'stream.offline') return new Response('Ignored', { status: 202 });

  const vod = (await latestTwitchVods(userId))[0];
  if (vod) for (const source of sources) if (new Date(vod.publishedAt).getTime() >= new Date(source.createdAt).getTime() - 5 * 60_000) await enqueueVideo(source, vod);
  return new Response(vod ? 'Accepted' : 'VOD not ready; polling fallback will retry', { status: 202 });
}
