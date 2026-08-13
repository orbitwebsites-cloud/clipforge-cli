import type { StoredChannel, StoredSourceChannel } from './types';
import { appUrl } from './app-url';

export const YOUTUBE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

export const googleOAuthRedirectUri = () => process.env.GOOGLE_OAUTH_REDIRECT_URI || `${appUrl()}/api/auth/youtube/callback`;

export async function exchangeCode(code: string) {
  const redirectUri = googleOAuthRedirectUri();
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID || '', client_secret: process.env.GOOGLE_CLIENT_SECRET || '', redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error_description || body.error || 'Google token exchange failed');
  return body as { access_token: string; refresh_token?: string };
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || '', client_secret: process.env.GOOGLE_CLIENT_SECRET || '', refresh_token: refreshToken, grant_type: 'refresh_token' }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error_description || body.error || 'Google token refresh failed');
  return body.access_token as string;
}

export async function ownedYouTubeChannel(accessToken: string) {
  const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', { headers: { authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok || !body.items?.[0]) throw new Error('No YouTube channel was found for this Google account');
  const item = body.items[0];
  return { youtubeChannelId: item.id as string, title: item.snippet.title as string, handle: item.snippet.customUrl || null, sourceUrl: `https://www.youtube.com/channel/${item.id}` };
}

export async function googleUserProfile(accessToken: string) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok || !body.email) throw new Error('Google account profile was unavailable');
  return { email: body.email as string, name: (body.name || body.email.split('@')[0]) as string };
}

export async function resolveYouTubeChannel(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname.toLowerCase())) throw new Error('Enter a youtube.com channel URL');
  const directId = url.pathname.match(/^\/channel\/(UC[\w-]{20,})/)?.[1];
  const handle = url.pathname.match(/^\/@([^/?]+)/)?.[1];
  let html = '';
  if (!directId || !handle) {
    const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 ClipForge/1.0' }, cache: 'no-store', redirect: 'follow' });
    if (!response.ok) throw new Error(`YouTube channel returned ${response.status}`);
    html = await response.text();
  }
  const youtubeChannelId = directId
    || html.match(/"channelId":"(UC[\w-]+)"/)?.[1]
    || html.match(/<meta itemprop="channelId" content="(UC[\w-]+)"/)?.[1]
    || html.match(/youtube\.com\/channel\/(UC[\w-]+)/)?.[1];
  if (!youtubeChannelId) throw new Error('Could not resolve that YouTube channel. Use its /channel/UC... URL.');
  const decodedTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&') || (handle ? `@${handle}` : 'YouTube channel');
  return { youtubeChannelId, title: decodedTitle, handle: handle ? `@${handle}` : null, url: directId ? `https://www.youtube.com/channel/${youtubeChannelId}` : rawUrl };
}

export async function subscribeWebSub(channel: StoredChannel | StoredSourceChannel) {
  const baseUrl = appUrl();
  if (!baseUrl.startsWith('https://')) return { skipped: true, reason: 'APP_URL must be public HTTPS' };
  const callback = `${baseUrl}/api/webhooks/youtube?channel=${encodeURIComponent(channel.youtubeChannelId)}&secret=${encodeURIComponent(channel.webhookSecret)}`;
  const response = await fetch('https://pubsubhubbub.appspot.com/subscribe', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.topic': `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.youtubeChannelId}`, 'hub.callback': callback, 'hub.verify': 'async', 'hub.lease_seconds': String(10 * 86400) }) });
  if (!response.ok && response.status !== 202 && response.status !== 204) throw new Error(`WebSub subscription failed (${response.status})`);
  return { skipped: false };
}

export function parseYouTubeAtom(xml: string) {
  const value = (tag: string) => xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`))?.[1]?.trim() || '';
  return { id: value('yt:videoId'), channelId: value('yt:channelId'), title: value('title'), publishedAt: value('published') };
}

export function parseYouTubeAtomEntries(xml: string) {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map(parseYouTubeAtom).filter((entry) => entry.id && entry.channelId);
}
