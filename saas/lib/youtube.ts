import type { PastVideo, StoredChannel, StoredSourceChannel } from './types';
import { appUrl } from './app-url';
import { channelIdFromChannelHtml, channelIdFromVideoHtml, youtubeVideoIdFromUrl } from './youtube-identity';

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

export async function publishYouTubeVideo(accessToken: string, videoId: string) {
  const response = await fetch('https://www.googleapis.com/youtube/v3/videos?part=status', {
    method: 'PUT',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: videoId, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } }),
    cache: 'no-store',
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'YouTube could not publish this Short');
  return body;
}

export async function ownedYouTubeChannel(accessToken: string) {
  const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', { headers: { authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok || !body.items?.[0]) throw new Error('No YouTube channel was found for this Google account');
  const item = body.items[0];
  return { youtubeChannelId: item.id as string, title: item.snippet.title as string, handle: item.snippet.customUrl || null, sourceUrl: `https://www.youtube.com/channel/${item.id}` };
}

export async function youtubePastVideos(accessToken: string, channelId: string, limit = 30): Promise<PastVideo[]> {
  const channelResponse = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  const channelBody = await channelResponse.json();
  const uploadsPlaylist = channelBody.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!channelResponse.ok || !uploadsPlaylist) throw new Error(channelBody.error?.message || 'YouTube could not load this source’s uploads playlist.');
  const pageSize = Math.min(50, Math.max(1, limit));
  const videosResponse = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploadsPlaylist)}&maxResults=${pageSize}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  const videosBody = await videosResponse.json();
  if (!videosResponse.ok) throw new Error(videosBody.error?.message || 'YouTube could not load past videos.');
  return (videosBody.items || []).flatMap((item: any) => {
    const id = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
    if (!id || ['Private video', 'Deleted video'].includes(item.snippet?.title)) return [];
    const thumbnails = item.snippet?.thumbnails || {};
    const thumbnailUrl = thumbnails.maxres?.url || thumbnails.standard?.url || thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url || null;
    return [{ id, title: item.snippet?.title || 'YouTube video', url: `https://www.youtube.com/watch?v=${id}`, publishedAt: item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || '', thumbnailUrl, platform: 'youtube' as const }];
  }).slice(0, pageSize);
}

export async function googleUserProfile(accessToken: string) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok || !body.email) throw new Error('Google account profile was unavailable');
  return { email: body.email as string, name: (body.name || body.email.split('@')[0]) as string };
}

export function normalizeYouTubeChannelInput(rawInput: string) {
  const input = rawInput.trim();
  if (!input) throw new Error('Enter a YouTube channel link or @handle.');
  if (input.startsWith('@')) return `https://www.youtube.com/${input}`;
  if (/^[\w.-]+$/.test(input)) return `https://www.youtube.com/@${input}`;
  if (/^(?:www\.|m\.)?youtube\.com\//i.test(input)) return `https://${input}`;
  if (/^(?:www\.)?youtu\.be\//i.test(input)) return `https://${input}`;
  return input;
}

export async function resolveYouTubeChannel(rawInput: string) {
  let url: URL;
  try { url = new URL(normalizeYouTubeChannelInput(rawInput)); }
  catch { throw new Error('Enter a YouTube channel link or @handle.'); }
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'].includes(url.hostname.toLowerCase())) throw new Error('Enter a youtube.com channel, video, Short, or stream link.');
  const directId = url.pathname.match(/^\/channel\/(UC[\w-]{20,})/)?.[1];
  const handle = url.pathname.match(/^\/@([^/?]+)/)?.[1];
  const videoId = youtubeVideoIdFromUrl(url);
  if (videoId) {
    const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const oembed = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`, { cache: 'no-store' });
    if (oembed.ok) {
      const owner = await oembed.json() as { author_url?: string };
      if (owner.author_url) return resolveYouTubeChannel(owner.author_url);
    }
    const response = await fetch(videoUrl, { headers: { 'user-agent': 'Mozilla/5.0 ClipForge/1.0' }, cache: 'no-store', redirect: 'follow' });
    if (!response.ok) throw new Error(`YouTube video returned ${response.status}`);
    const html = await response.text();
    const uploaderId = channelIdFromVideoHtml(html);
    if (!uploaderId) throw new Error('Could not identify the YouTube channel that published that video.');
    return resolveYouTubeChannel(`https://www.youtube.com/channel/${uploaderId}`);
  }

  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 ClipForge/1.0' }, cache: 'no-store', redirect: 'follow' });
  if (!response.ok) throw new Error(response.status === 404 ? 'YouTube could not find that channel. Check the @handle and try again.' : `YouTube channel returned ${response.status}`);
  const html = await response.text();
  const youtubeChannelId = directId || channelIdFromChannelHtml(html);
  if (!youtubeChannelId) throw new Error('Could not identify that YouTube channel. Paste its @handle, channel link, or a video from the channel.');
  const decodedTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&') || (handle ? `@${handle}` : 'YouTube channel');
  return { youtubeChannelId, platform: 'youtube' as const, platformUserId: youtubeChannelId, platformLogin: handle || null, title: decodedTitle, handle: handle ? `@${handle}` : null, url: directId ? `https://www.youtube.com/channel/${youtubeChannelId}` : url.toString() };
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
