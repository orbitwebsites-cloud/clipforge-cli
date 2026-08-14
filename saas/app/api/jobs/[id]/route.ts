import { cancelJob, requeueJob } from '@/lib/repository';
import { tenantIdFromSession } from '@/lib/session';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const [tenantId, { id }] = await Promise.all([tenantIdFromSession(), params]);
    await cancelJob(tenantId, id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Cancel failed' },
      { status: 400 },
    );
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const [tenantId, { id }] = await Promise.all([tenantIdFromSession(), params]);
    await requeueJob(tenantId, id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Retry failed' },
      { status: 400 },
    );
  }
}
