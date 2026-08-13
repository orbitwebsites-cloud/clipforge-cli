alter table source_channels add column if not exists platform text not null default 'youtube';
alter table source_channels add column if not exists platform_user_id text;
alter table source_channels add column if not exists platform_login text;

update source_channels set platform_user_id=youtube_channel_id where platform_user_id is null;
alter table source_channels alter column platform_user_id set not null;
alter table source_channels drop constraint if exists source_channels_platform_check;
alter table source_channels add constraint source_channels_platform_check check (platform in ('youtube','twitch'));
create unique index if not exists source_channels_tenant_platform_user_idx on source_channels(tenant_id,platform,platform_user_id);
