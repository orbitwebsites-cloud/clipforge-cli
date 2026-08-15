import { z } from 'zod';
import { getDashboard, setJobPriority } from '@/lib/repository';
import { tenantIdFromSession } from '@/lib/session';

const schema = z.object({
  priority: z.number().int().min(-10).max(10),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await tenantIdFromSession();
    const { id: jobId } = await params;
    const { priority } = schema.parse(await request.json());
    await setJobPriority(tenantId, jobId, priority);
    const dashboard = await getDashboard(tenantId);
    return Response.json({ ok: true, dashboard });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : 'Could not update priority';
    return Response.json({ error: message }, { status: 400 });
  }
}
