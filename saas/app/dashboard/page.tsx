import { getDashboard } from '@/lib/repository';
import { ensureCurrentTenant } from '@/lib/session';
import { redirect } from 'next/navigation';
import Dashboard from './dashboard';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  let tenantId: string;
  try {
    tenantId = (await ensureCurrentTenant()).id;
  } catch {
    redirect('/sign-in');
  }
  const data = await getDashboard(tenantId);
  return <Dashboard initial={data} />;
}
