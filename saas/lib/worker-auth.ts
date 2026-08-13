import { timingSafeEqual } from 'node:crypto';

export function authorizeWorker(request: Request) {
  const expected = Buffer.from(process.env.WORKER_SECRET || '');
  const supplied = Buffer.from(request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '');
  return expected.length > 20 && expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
