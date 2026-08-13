import { Pool, type QueryResultRow } from 'pg';

let pool: Pool | null = null;
export const databaseEnabled = () => Boolean(process.env.DATABASE_URL);

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  pool ||= new Pool({ connectionString: process.env.DATABASE_URL, max: 12, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
  return pool.query<T>(text, values);
}
