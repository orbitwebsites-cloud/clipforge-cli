import { z } from 'zod';
import { updateJob } from '@/lib/repository';
import { authorizeWorker } from '@/lib/worker-auth';

const schema = z.object({ jobId: z.string(), workerId: z.string(), status: z.enum(['downloading','transcribing','selecting','rendering','uploading','complete','failed']), progress: z.number().int().min(0).max(100), error: z.string().max(1000).nullable().optional() });
export async function POST(request: Request) {
  if (!authorizeWorker(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  try { const body = schema.parse(await request.json()); return Response.json({ job: await updateJob(body.jobId, body.workerId, body.status, body.progress, body.error || null) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Update failed' }, { status: 400 }); }
}
