import { NextRequest } from 'next/server';
import { enqueueVideo, webhookSourceChannel } from '@/lib/repository';
import { parseYouTubeAtom } from '@/lib/youtube';

async function authenticatedChannel(request: NextRequest) {
  const channel = request.nextUrl.searchParams.get('channel') || '';
  const secret = request.nextUrl.searchParams.get('secret') || '';
  return webhookSourceChannel(channel, secret);
}

export async function GET(request: NextRequest) {
  const channel = await authenticatedChannel(request);
  if (!channel) return new Response('Forbidden', { status: 403 });
  const challenge = request.nextUrl.searchParams.get('hub.challenge');
  return challenge ? new Response(challenge, { headers: { 'content-type': 'text/plain' } }) : new Response('ok');
}

export async function POST(request: NextRequest) {
  const channel = await authenticatedChannel(request);
  if (!channel) return new Response('Forbidden', { status: 403 });
  const event = parseYouTubeAtom(await request.text());
  if (!event.id || event.channelId !== channel.youtubeChannelId) return new Response('Ignored', { status: 202 });
  if (event.publishedAt && new Date(event.publishedAt).getTime() < new Date(channel.createdAt).getTime() - 5 * 60000) return new Response('Historical event ignored', { status: 202 });
  await enqueueVideo(channel, event);
  return new Response('Accepted', { status: 202 });
}
