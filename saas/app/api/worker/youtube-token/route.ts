import { z } from 'zod';
import { decryptSecret } from '@/lib/crypto';
import { channelRefreshToken } from '@/lib/repository';
import { authorizeWorker } from '@/lib/worker-auth';
import { refreshGoogleAccessToken } from '@/lib/youtube';

export async function POST(request: Request) {
  if (!authorizeWorker(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { channelId } = z.object({ channelId: z.string() }).parse(await request.json());
    const encrypted = await channelRefreshToken(channelId);
    if (!encrypted || encrypted === 'demo') throw new Error('Channel OAuth is not configured');
    return Response.json({ accessToken: await refreshGoogleAccessToken(decryptSecret(encrypted)), expiresIn: 3300 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Token unavailable' }, { status: 400 }); }
}
