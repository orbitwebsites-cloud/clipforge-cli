import { z } from 'zod';
import { leaseNextJob } from '@/lib/repository';
import { authorizeWorker } from '@/lib/worker-auth';

export async function POST(request: Request) {
  if (!authorizeWorker(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { workerId } = z.object({ workerId: z.string().min(3).max(100) }).parse(await request.json());
  return Response.json({ job: await leaseNextJob(workerId) });
}
