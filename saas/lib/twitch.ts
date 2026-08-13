import type { StoredSourceChannel } from './types';
import { appUrl } from './app-url';

type TwitchToken = { value: string; expiresAt: number };
const twitchState = globalThis as typeof globalThis & { __clipforgeTwitchToken?: TwitchToken };

function credentials() {
  const clientId = process.env.TWITCH_CLIENT_ID || '';
  const clientSecret = process.env.TWITCH_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('Twitch integration is not configured yet. Add the Twitch Client ID and Client Secret.');
  return { clientId, clientSecret };
}

export function twitchEventSubSecret() {
  const secret = process.env.TWITCH_EVENTSUB_SECRET || '';
  if (secret.length < 20) throw new Error('TWITCH_EVENTSUB_SECRET is not configured.');
  return secret;
}

async function appAccessToken() {
  if (twitchState.__clipforgeTwitchToken && twitchState.__clipforgeTwitchToken.expiresAt > Date.now() + 60_000) return twitchState.__clipforgeTwitchToken.value;
  const { clientId, clientSecret } = credentials();
  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.search = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }).toString();
  const response = await fetch(url, { method: 'POST', cache: 'no-store' });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error('Twitch authentication failed. Check the Twitch app credentials.');
  twitchState.__clipforgeTwitchToken = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 };
  return body.access_token as string;
}

async function helix(path: string) {
  const { clientId } = credentials();
  const response = await fetch(`https://api.twitch.tv/helix/${path}`, { headers: { 'client-id': clientId, authorization: `Bearer ${await appAccessToken()}` }, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || `Twitch returned ${response.status}`);
  return body;
}

export function isTwitchInput(input: string) {
  return /^(?:https?:\/\/)?(?:www\.)?twitch\.tv\//i.test(input.trim());
}

export async function resolveTwitchChannel(rawInput: string) {
  const input = rawInput.trim();
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); }
  catch { throw new Error('Enter a Twitch channel link such as twitch.tv/creator.'); }
  if (!['twitch.tv', 'www.twitch.tv'].includes(url.hostname.toLowerCase())) throw new Error('Enter a twitch.tv channel link.');
  const segments = url.pathname.split('/').filter(Boolean);
  let user: any;
  if (segments[0]?.toLowerCase() === 'videos' && /^\d+$/.test(segments[1] || '')) {
    const video = (await helix(`videos?id=${encodeURIComponent(segments[1])}`)).data?.[0];
    if (!video?.user_id) throw new Error('Twitch could not find that VOD. It may be private or expired.');
    user = (await helix(`users?id=${encodeURIComponent(video.user_id)}`)).data?.[0];
  } else {
    const login = segments[0]?.toLowerCase();
    if (!login || ['directory', 'downloads'].includes(login)) throw new Error('Enter a Twitch creator channel or VOD link.');
    user = (await helix(`users?login=${encodeURIComponent(login)}`)).data?.[0];
  }
  if (!user) throw new Error('Twitch could not find that creator. Check the channel or VOD link and try again.');
  return { youtubeChannelId: `twitch:${user.id}`, platform: 'twitch' as const, platformUserId: user.id as string, platformLogin: user.login as string, title: (user.display_name || user.login) as string, handle: user.login as string, url: `https://www.twitch.tv/${user.login}` };
}

export async function latestTwitchVods(userId: string) {
  const body = await helix(`videos?user_id=${encodeURIComponent(userId)}&type=archive&first=5`);
  return (body.data || []).map((video: any) => ({ id: `twitch:${video.id}`, title: video.title || 'Twitch stream replay', publishedAt: video.created_at as string, url: video.url || `https://www.twitch.tv/videos/${video.id}` }));
}

export async function subscribeTwitchEventSub(source: StoredSourceChannel) {
  if (source.platform !== 'twitch') return { skipped: true };
  const { clientId } = credentials();
  const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: { 'client-id': clientId, authorization: `Bearer ${await appAccessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'stream.offline', version: '1', condition: { broadcaster_user_id: source.platformUserId }, transport: { method: 'webhook', callback: `${appUrl()}/api/webhooks/twitch`, secret: twitchEventSubSecret() } }),
  });
  if (!response.ok && response.status !== 409) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Twitch EventSub returned ${response.status}`);
  }
  return { skipped: false };
}
