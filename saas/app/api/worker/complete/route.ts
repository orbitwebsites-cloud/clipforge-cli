import { z } from 'zod';
import { replaceJobClips, updateJob } from '@/lib/repository';
import { authorizeWorker } from '@/lib/worker-auth';

const schema = z.object({ jobId: z.string(), workerId: z.string(), clips: z.array(z.object({ title: z.string(), durationSeconds: z.number(), youtubeVideoId: z.string(), youtubeUrl: z.string().url() })).min(1) });
export async function POST(request: Request) {
  if (!authorizeWorker(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  try { const body = schema.parse(await request.json()); await replaceJobClips(body.jobId, body.clips); await updateJob(body.jobId, body.workerId, 'complete', 100); return Response.json({ ok: true }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Completion failed' }, { status: 400 }); }
}
