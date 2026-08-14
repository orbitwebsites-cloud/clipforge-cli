import { getDashboard } from '@/lib/repository';
import { ensureCurrentTenant } from '@/lib/session';
import { redirect } from 'next/navigation';
import Dashboard from './dashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  let tenantId: string;
  try {
    tenantId = (await ensureCurrentTenant()).id;
  } catch {
    redirect('/sign-in');
  }
  const [data, params] = await Promise.all([
    getDashboard(tenantId),
    searchParams,
  ]);
  return (
    <Dashboard
      initial={data}
      initialTab={typeof params.tab === 'string' ? params.tab : undefined}
    />
  );
}
