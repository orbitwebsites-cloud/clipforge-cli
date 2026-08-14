create table if not exists tenants (
  id text primary key,
  name text not null,
  email text not null unique,
  plan text not null default 'free' check (plan in ('free','creator','clipping','studio')),
  subscription_status text not null default 'active',
  stripe_customer_id text,
  stripe_subscription_id text,
  clips_this_month integer not null default 0,
  monthly_clip_limit integer not null default 10,
  source_channel_limit integer not null default 1,
  complimentary_creator boolean not null default false,
  creator_preferences jsonb not null default '{"publishMode":"automatic","clipsPerVideo":3,"minClipSeconds":15,"maxClipSeconds":32,"captionStyle":"impact","brandColor":"#C8FF38","hashtags":"#Shorts #Minecraft","learningEnabled":true}'::jsonb,
  usage_month date not null default date_trunc('month',now())::date,
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
  platform text not null default 'youtube' check (platform in ('youtube','twitch')),
  platform_user_id text not null,
  platform_login text,
  title text not null,
  handle text,
  url text not null,
  connected boolean not null default true,
  rights_confirmed boolean not null default false,
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
  privacy_status text check (privacy_status is null or privacy_status in ('public','private')),
  created_at timestamptz not null default now(),
  unique(job_id, youtube_video_id)
);
