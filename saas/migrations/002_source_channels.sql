create table if not exists source_channels (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  destination_channel_id text not null references channels(id) on delete cascade,
  youtube_channel_id text not null,
  title text not null,
  handle text,
  url text not null,
  connected boolean not null default true,
  webhook_secret text not null,
  last_polled_at timestamptz,
  websub_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, youtube_channel_id)
);

create index if not exists source_channels_poll_idx on source_channels(connected, last_polled_at);
