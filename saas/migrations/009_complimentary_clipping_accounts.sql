update tenants
set plan='clipping',
    subscription_status='active',
    monthly_clip_limit=150,
    source_channel_limit=15,
    complimentary_creator=true
where lower(email) in ('rrus3676@gmail.com','orbitboyzz@gmail.com');
