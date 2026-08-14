alter table tenants drop constraint if exists tenants_plan_check;
alter table tenants add constraint tenants_plan_check
  check (plan in ('free','creator','clipping','studio'));

update tenants
set monthly_clip_limit=150,source_channel_limit=15
where plan='clipping';
