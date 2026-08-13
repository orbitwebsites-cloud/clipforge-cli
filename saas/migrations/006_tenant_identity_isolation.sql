alter table tenants drop constraint if exists tenants_email_key;
drop index if exists tenants_email_key;
create index if not exists tenants_email_lookup_idx on tenants(lower(email));
