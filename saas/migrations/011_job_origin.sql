-- Distinguishes jobs queued from live channel monitoring vs manually backfilled
-- past videos, so features like auto-delete can exclude backfill batches.
alter table jobs add column if not exists origin text not null default 'live';
