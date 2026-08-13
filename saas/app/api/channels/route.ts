import { z } from 'zod';
import { addSourceChannel, getDashboard, removeSourceChannel } from '@/lib/repository';
import { tenantIdFromSession } from '@/lib/session';
import { resolveYouTubeChannel, subscribeWebSub } from '@/lib/youtube';

const inputSchema = z.object({ url: z.string().url().refine((value) => new URL(value).hostname.endsWith('youtube.com'), 'Enter a YouTube channel URL') });

export async function POST(request: Request) {
  try {
    const tenantId = await tenantIdFromSession();
    const { url } = inputSchema.parse(await request.json());
    const dashboard = await getDashboard(tenantId);
    const destination = dashboard.channels[0];
    if (!destination) return Response.json({ error: 'Connect YouTube first.' }, { status: 409 });
    const source = await addSourceChannel(tenantId, destination.id, await resolveYouTubeChannel(url));
    await subscribeWebSub(source);
    return Response.json({ ok: true, dashboard: await getDashboard(tenantId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid channel';
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const tenantId = await tenantIdFromSession();
    const { id } = z.object({ id: z.string().min(1) }).parse(await request.json());
    await removeSourceChannel(tenantId, id);
    return Response.json({ ok: true, dashboard: await getDashboard(tenantId) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not remove source' }, { status: 400 });
  }
}
