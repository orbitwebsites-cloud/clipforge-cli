alter table tenants drop constraint if exists tenants_plan_check;
update tenants set plan='free' where plan='trial';
alter table tenants alter column plan set default 'free';
alter table tenants add constraint tenants_plan_check check (plan in ('free','creator','studio'));

alter table tenants add column if not exists source_channel_limit integer not null default 1;
alter table tenants add column if not exists complimentary_creator boolean not null default false;
alter table tenants add column if not exists usage_month date not null default date_trunc('month',now())::date;

update tenants set monthly_clip_limit=10,source_channel_limit=1,subscription_status='active' where plan='free';
update tenants set monthly_clip_limit=150,source_channel_limit=5 where plan='creator';
update tenants set monthly_clip_limit=500,source_channel_limit=20 where plan='studio';

update tenants set plan='creator',subscription_status='active',monthly_clip_limit=150,
  source_channel_limit=5,complimentary_creator=true
where lower(email)='rrus3676@gmail.com';
