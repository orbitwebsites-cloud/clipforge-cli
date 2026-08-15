export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (!process.env.DATABASE_URL) return;
  try {
    const { query } = await import('@/lib/db');
    await query(`alter table jobs add column if not exists priority int not null default 0`);
    await query(`create index if not exists jobs_priority_idx on jobs (priority desc, deadline_at asc)`);
    await query(`alter table jobs add column if not exists origin text not null default 'live'`);
  } catch {
    // Non-fatal — migration may already be applied or DB unreachable at boot
  }
}
