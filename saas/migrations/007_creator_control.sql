alter table tenants add column if not exists creator_preferences jsonb not null default '{
  "publishMode":"automatic",
  "clipsPerVideo":3,
  "minClipSeconds":15,
  "maxClipSeconds":32,
  "captionStyle":"impact",
  "brandColor":"#C8FF38",
  "hashtags":"#Shorts #Minecraft",
  "learningEnabled":true
}'::jsonb;

alter table source_channels add column if not exists rights_confirmed boolean not null default false;
alter table clips add column if not exists privacy_status text;

update clips set privacy_status=case when status='review' then 'private' else 'public' end
where privacy_status is null and youtube_video_id is not null;

alter table clips drop constraint if exists clips_privacy_status_check;
alter table clips add constraint clips_privacy_status_check
  check (privacy_status is null or privacy_status in ('public','private'));
