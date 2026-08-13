import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { encryptSecret, verifyState } from '@/lib/crypto';
import { saveConnectedChannel } from '@/lib/repository';
import { exchangeCode, ownedYouTubeChannel } from '@/lib/youtube';
import { appUrl } from '@/lib/app-url';

export async function GET(request: NextRequest) {
  const baseUrl = appUrl();
  try {
    const code = request.nextUrl.searchParams.get('code');
    const stateValue = request.nextUrl.searchParams.get('state');
    const jar = await cookies();
    if (!code || !stateValue || stateValue !== jar.get('youtube_oauth_state')?.value) throw new Error('Invalid OAuth state');
    const state = verifyState<{ tenantId: string; exp: number }>(stateValue);
    if (!state || state.exp < Date.now()) throw new Error('Expired OAuth state');
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) throw new Error('Google did not return offline access. Revoke the app and reconnect.');
    const owned = await ownedYouTubeChannel(tokens.access_token);
    await saveConnectedChannel(state.tenantId, { ...owned, refreshTokenEncrypted: encryptSecret(tokens.refresh_token) });
    jar.delete('youtube_oauth_state');
    return NextResponse.redirect(new URL('/dashboard?youtube=connected', baseUrl));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'YouTube connection failed';
    return NextResponse.redirect(new URL(`/dashboard?youtube_error=${encodeURIComponent(message)}`, baseUrl));
  }
}
