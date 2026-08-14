import { z } from 'zod';
import { getDashboard, updateCreatorPreferences } from '@/lib/repository';
import { tenantIdFromSession } from '@/lib/session';

const schema = z.object({
  publishMode: z.enum(['automatic', 'review']),
  clipsPerVideo: z.number().int().min(1).max(5),
  minClipSeconds: z.number().int().min(10).max(30),
  maxClipSeconds: z.number().int().min(15).max(60),
  captionStyle: z.enum(['impact', 'clean', 'minimal']),
  brandColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  hashtags: z.string().trim().max(160),
  learningEnabled: z.boolean(),
}).refine((value) => value.maxClipSeconds > value.minClipSeconds, { message: 'Maximum clip length must be greater than the minimum.' });

export async function PUT(request: Request) {
  try {
    const tenantId = await tenantIdFromSession();
    const preferences = schema.parse(await request.json());
    await updateCreatorPreferences(tenantId, preferences);
    return Response.json({ ok: true, dashboard: await getDashboard(tenantId) });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : 'Settings could not be saved';
    return Response.json({ error: message }, { status: 400 });
  }
}
