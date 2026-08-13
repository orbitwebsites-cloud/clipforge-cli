const channelIdPattern = '(UC[\\w-]{20,})';

export function youtubeVideoIdFromUrl(url: URL) {
  if (url.hostname.toLowerCase() === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || null;
  if (url.pathname === '/watch') return url.searchParams.get('v');
  return url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/)?.[1] || null;
}

export function channelIdFromChannelHtml(html: string) {
  const canonical = html.match(new RegExp(`<link[^>]+rel="canonical"[^>]+href="https?://(?:www\\.)?youtube\\.com/channel/${channelIdPattern}`, 'i'))?.[1];
  const metadata = html.match(new RegExp(`"channelMetadataRenderer":\\{[\\s\\S]{0,8000}?"externalId":"${channelIdPattern}"`))?.[1];
  const metaTag = html.match(new RegExp(`<meta[^>]+itemprop="channelId"[^>]+content="${channelIdPattern}"`, 'i'))?.[1];
  const fallback = html.match(new RegExp(`"externalId":"${channelIdPattern}"`))?.[1];
  return canonical || metadata || metaTag || fallback || null;
}

export function channelIdFromVideoHtml(html: string) {
  const details = html.match(new RegExp(`"videoDetails":\\{[\\s\\S]{0,12000}?"channelId":"${channelIdPattern}"`))?.[1];
  const owner = html.match(new RegExp(`"videoOwnerRenderer":\\{[\\s\\S]{0,8000}?"browseId":"${channelIdPattern}"`))?.[1];
  return details || owner || null;
}
