create table if not exists tenants (
  id text primary key,
  name text not null,
  email text not null unique,
  plan text not null default 'trial' check (plan in ('trial','creator','studio')),
  subscription_status text not null default 'trialing',
  stripe_customer_id text,
  stripe_subscription_id text,
  clips_this_month integer not null default 0,
  monthly_clip_limit integer not null default 30,
  created_at timestamptz not null default now()
);

create table if not exists channels (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  youtube_channel_id text not null,
  title text not null,
  handle text,
  source_url text not null,
  connected boolean not null default false,
  webhook_secret text not null,
  refresh_token_encrypted text not null,
  last_polled_at timestamptz,
  websub_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, youtube_channel_id)
);

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

create table if not exists jobs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  channel_id text not null references channels(id) on delete cascade,
  source_video_id text not null,
  source_title text not null,
  source_url text not null,
  status text not null,
  progress integer not null default 0 check (progress between 0 and 100),
  detected_at timestamptz not null,
  deadline_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  error text,
  unique (tenant_id, source_video_id)
);
create index if not exists jobs_queue_deadline_idx on jobs(status, deadline_at);

create table if not exists clips (
  id text primary key,
  job_id text not null references jobs(id) on delete cascade,
  title text not null,
  duration_seconds numeric(6,2) not null,
  youtube_video_id text,
  youtube_url text,
  status text not null,
  created_at timestamptz not null default now(),
  unique(job_id, youtube_video_id)
);
