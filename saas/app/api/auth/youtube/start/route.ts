import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { signState } from '@/lib/crypto';
import { tenantIdFromSession } from '@/lib/session';
import { YOUTUBE_SCOPES } from '@/lib/youtube';
import { appUrl } from '@/lib/app-url';

export async function GET() {
  try {
    const tenantId = await tenantIdFromSession();
    if (!process.env.GOOGLE_CLIENT_ID) return NextResponse.redirect(new URL('/dashboard?youtube=configure-google', appUrl()));
    const state = signState({ tenantId, nonce: crypto.randomUUID(), exp: Date.now() + 10 * 60000 });
    const jar = await cookies();
    jar.set('youtube_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 600, path: '/' });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: `${appUrl()}/api/auth/youtube/callback`, response_type: 'code', scope: YOUTUBE_SCOPES.join(' '), access_type: 'offline', include_granted_scopes: 'true', prompt: 'consent', state }).toString();
    return NextResponse.redirect(url);
  } catch { return NextResponse.redirect(new URL('/?auth=unavailable', appUrl())); }
}
