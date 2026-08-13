import { z } from 'zod';
import { addSourceChannel, getDashboard, removeSourceChannel } from '@/lib/repository';
import { tenantIdFromSession } from '@/lib/session';
import { resolveYouTubeChannel, subscribeWebSub } from '@/lib/youtube';

const inputSchema = z.object({ url: z.string().trim().min(1, 'Enter a YouTube channel link or @handle.').max(500) });

export async function POST(request: Request) {
  try {
    const tenantId = await tenantIdFromSession();
    const { url } = inputSchema.parse(await request.json());
    const dashboard = await getDashboard(tenantId);
    const destination = dashboard.channels[0];
    if (!destination) return Response.json({ error: 'Connect YouTube first.' }, { status: 409 });
    const resolved = await resolveYouTubeChannel(url);
    const alreadyConnected = dashboard.sourceChannels.find((source) => source.youtubeChannelId === resolved.youtubeChannelId);
    if (alreadyConnected) return Response.json({ ok: true, alreadyConnected: true, message: `${alreadyConnected.title} is already connected. Paste a different channel to add another source.`, dashboard });
    const source = await addSourceChannel(tenantId, destination.id, resolved);
    await subscribeWebSub(source);
    const updated = await getDashboard(tenantId);
    return Response.json({ ok: true, message: `${source.title} connected (${updated.sourceChannels.length}/${updated.tenant.sourceChannelLimit} sources).`, dashboard: updated });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : 'Invalid channel';
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
