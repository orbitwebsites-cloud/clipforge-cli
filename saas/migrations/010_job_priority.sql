-- User-controlled priority queue: higher number = processed sooner
-- 0 = normal (default), 10 = high, -10 = low
alter table jobs add column if not exists priority int not null default 0;
create index if not exists jobs_priority_idx on jobs (priority desc, deadline_at asc);
