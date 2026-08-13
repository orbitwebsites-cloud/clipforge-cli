import { getDashboard } from '@/lib/repository';
import { tenantIdFromSession } from '@/lib/session';

export async function GET() {
  try { return Response.json(await getDashboard(await tenantIdFromSession())); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Unauthorized' }, { status: 401 }); }
}
