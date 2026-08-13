create table if not exists channel_analytics_snapshots (
  channel_id text not null references channels(id) on delete cascade,
  range_days integer not null check (range_days in (7,28,90)),
  data jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (channel_id,range_days)
);

create index if not exists channel_analytics_freshness_idx
  on channel_analytics_snapshots(channel_id,synced_at desc);
