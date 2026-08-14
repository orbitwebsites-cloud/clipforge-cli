import { getDashboard } from '@/lib/repository';
import { tenantIdFromSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    return Response.json(await getDashboard(await tenantIdFromSession()), {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Unauthorized' }, { status: 401 }); }
}
