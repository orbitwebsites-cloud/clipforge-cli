import { randomBytes, randomUUID } from 'node:crypto';
import { databaseEnabled, query } from './db';
import { demoAddChannel, demoAddSourceChannel, demoDashboard, demoEnqueue, demoStore } from './demo-store';
import type { Channel, DashboardData, Job, JobStatus, StoredChannel, StoredSourceChannel } from './types';

export async function getDashboard(tenantId: string): Promise<DashboardData> {
  if (!databaseEnabled()) return demoDashboard(tenantId);
  const [tenantResult, channelResult, sourceResult, jobResult, clipResult] = await Promise.all([
    query<any>('select * from tenants where id=$1', [tenantId]),
    query<any>('select * from channels where tenant_id=$1 and connected=true order by created_at desc', [tenantId]),
    query<any>('select * from source_channels where tenant_id=$1 order by created_at', [tenantId]),
    query<any>('select * from jobs where tenant_id=$1 order by detected_at desc limit 50', [tenantId]),
    query<any>('select c.* from clips c join jobs j on j.id=c.job_id where j.tenant_id=$1 order by c.created_at', [tenantId]),
  ]);
  const tenant = tenantResult.rows[0];
  if (!tenant) throw new Error('Tenant not found');
  const clipsByJob = new Map<string, any[]>();
  for (const clip of clipResult.rows) clipsByJob.set(clip.job_id, [...(clipsByJob.get(clip.job_id) || []), mapClip(clip)]);
  const jobs = jobResult.rows.map((row: any) => mapJob(row, clipsByJob.get(row.id) || []));
  const completed = jobs.filter((job: Job) => job.completedAt);
  const minutes = completed.map((job: Job) => (new Date(job.completedAt!).getTime() - new Date(job.detectedAt).getTime()) / 60000);
  return {
    tenant: { id: tenant.id, name: tenant.name, email: tenant.email, plan: tenant.plan, subscriptionStatus: tenant.subscription_status, stripeCustomerId: tenant.stripe_customer_id, clipsThisMonth: Number(tenant.clips_this_month), monthlyClipLimit: Number(tenant.monthly_clip_limit) },
    channels: channelResult.rows.map(mapChannel).map(publicChannel),
    sourceChannels: sourceResult.rows.map(mapSourceChannel).map(publicSourceChannel), jobs,
    sla: { targetMinutes: 180, deliveredOnTimePercent: minutes.length ? Math.round(100 * minutes.filter((m) => m <= 180).length / minutes.length) : 100, averageMinutes: minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : 0 },
  };
}

export async function ensureTenant(id: string, profile: { email: string; name: string }) {
  if (!databaseEnabled()) {
    const store = demoStore();
    const existing = store.tenants.find((tenant) => tenant.id === id || tenant.email === profile.email);
    if (existing) return existing;
    const tenant = { id, name: profile.name, email: profile.email, plan: 'trial' as const, subscriptionStatus: 'trialing' as const, stripeCustomerId: null, clipsThisMonth: 0, monthlyClipLimit: 15 };
    store.tenants.push(tenant); return tenant;
  }
  const result = await query<any>(`insert into tenants (id,name,email,plan,subscription_status,monthly_clip_limit)
    values ($1,$2,$3,'trial','trialing',15) on conflict (email) do update set name=excluded.name returning *`, [id, profile.name, profile.email]);
  return result.rows[0];
}

const mapChannel = (row: any): StoredChannel => ({ id: row.id, tenantId: row.tenant_id, youtubeChannelId: row.youtube_channel_id, title: row.title, handle: row.handle, sourceUrl: row.source_url, connected: row.connected, webhookSecret: row.webhook_secret, refreshTokenEncrypted: row.refresh_token_encrypted, createdAt: row.created_at.toISOString?.() || row.created_at });
const publicChannel = ({ webhookSecret: _webhookSecret, refreshTokenEncrypted: _refreshToken, ...channel }: StoredChannel): Channel => channel;
const mapSourceChannel = (row: any): StoredSourceChannel => ({ id: row.id, tenantId: row.tenant_id, youtubeChannelId: row.youtube_channel_id, title: row.title, handle: row.handle, url: row.url, connected: row.connected, webhookSecret: row.webhook_secret, destinationChannelId: row.destination_channel_id, createdAt: row.created_at.toISOString?.() || row.created_at });
const publicSourceChannel = ({ webhookSecret: _webhookSecret, destinationChannelId: _destination, ...channel }: StoredSourceChannel) => channel;
const mapClip = (row: any) => ({ id: row.id, jobId: row.job_id, title: row.title, durationSeconds: Number(row.duration_seconds), youtubeVideoId: row.youtube_video_id, youtubeUrl: row.youtube_url, status: row.status });
const mapJob = (row: any, clips: any[] = []): Job => ({ id: row.id, tenantId: row.tenant_id, channelId: row.channel_id, sourceVideoId: row.source_video_id, sourceTitle: row.source_title, sourceUrl: row.source_url, status: row.status, progress: Number(row.progress), detectedAt: row.detected_at.toISOString?.() || row.detected_at, deadlineAt: row.deadline_at.toISOString?.() || row.deadline_at, startedAt: row.started_at?.toISOString?.() || row.started_at, completedAt: row.completed_at?.toISOString?.() || row.completed_at, error: row.error, leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at?.toISOString?.() || row.lease_expires_at, clips });

export async function saveConnectedChannel(tenantId: string, input: { youtubeChannelId: string; title: string; handle: string | null; sourceUrl: string; refreshTokenEncrypted: string }) {
  const webhookSecret = randomBytes(24).toString('base64url');
  if (!databaseEnabled()) {
    for (const channel of demoStore().channels) if (channel.tenantId === tenantId) channel.connected = false;
    const existing = demoStore().channels.find((c) => c.tenantId === tenantId && c.youtubeChannelId === input.youtubeChannelId);
    const destination = existing ? Object.assign(existing, input, { connected: true }) : demoAddChannel(tenantId, { ...input, connected: true, webhookSecret });
    for (const source of demoStore().sourceChannels) if (source.tenantId === tenantId) source.destinationChannelId = destination.id;
    return destination;
  }
  await query('update channels set connected=false where tenant_id=$1', [tenantId]);
  const result = await query<any>(`insert into channels (id,tenant_id,youtube_channel_id,title,handle,source_url,connected,webhook_secret,refresh_token_encrypted)
    values ($1,$2,$3,$4,$5,$6,true,$7,$8)
    on conflict (tenant_id,youtube_channel_id) do update set title=excluded.title,handle=excluded.handle,source_url=excluded.source_url,connected=true,refresh_token_encrypted=excluded.refresh_token_encrypted
    returning *`, [randomUUID(), tenantId, input.youtubeChannelId, input.title, input.handle, input.sourceUrl, webhookSecret, input.refreshTokenEncrypted]);
  const destination = mapChannel(result.rows[0]);
  await query('update source_channels set destination_channel_id=$2 where tenant_id=$1', [tenantId, destination.id]);
  return destination;
}

export async function addSourceChannel(tenantId: string, destinationChannelId: string, input: { youtubeChannelId: string; title: string; handle: string | null; url: string }) {
  const webhookSecret = randomBytes(24).toString('base64url');
  if (!databaseEnabled()) {
    const existing = demoStore().sourceChannels.find((source) => source.tenantId === tenantId && source.youtubeChannelId === input.youtubeChannelId);
    if (existing) return existing;
    return demoAddSourceChannel(tenantId, { ...input, destinationChannelId, connected: true, webhookSecret });
  }
  const result = await query<any>(`insert into source_channels (id,tenant_id,destination_channel_id,youtube_channel_id,title,handle,url,connected,webhook_secret)
    values ($1,$2,$3,$4,$5,$6,$7,true,$8)
    on conflict (tenant_id,youtube_channel_id) do update set title=excluded.title,handle=excluded.handle,url=excluded.url,connected=true,destination_channel_id=excluded.destination_channel_id
    returning *`, [randomUUID(), tenantId, destinationChannelId, input.youtubeChannelId, input.title, input.handle, input.url, webhookSecret]);
  return mapSourceChannel(result.rows[0]);
}

export async function removeSourceChannel(tenantId: string, sourceId: string) {
  if (!databaseEnabled()) {
    const index = demoStore().sourceChannels.findIndex((source) => source.id === sourceId && source.tenantId === tenantId);
    if (index < 0) throw new Error('Source channel not found');
    demoStore().sourceChannels.splice(index, 1); return;
  }
  const result = await query('delete from source_channels where id=$1 and tenant_id=$2 returning id', [sourceId, tenantId]);
  if (!result.rowCount) throw new Error('Source channel not found');
}

export async function webhookSourceChannel(channelId: string, secret: string) {
  if (!databaseEnabled()) return demoStore().sourceChannels.find((source) => source.youtubeChannelId === channelId && source.webhookSecret === secret) || null;
  const result = await query<any>('select * from source_channels where youtube_channel_id=$1 and webhook_secret=$2', [channelId, secret]);
  return result.rows[0] ? mapSourceChannel(result.rows[0]) : null;
}

export async function enqueueVideo(source: StoredSourceChannel, video: { id: string; title: string; publishedAt?: string }) {
  const detectedAt = new Date();
  const base = { tenantId: source.tenantId, channelId: source.destinationChannelId, sourceVideoId: video.id, sourceTitle: video.title, sourceUrl: `https://youtube.com/watch?v=${video.id}`, detectedAt: detectedAt.toISOString(), deadlineAt: new Date(detectedAt.getTime() + 180 * 60000).toISOString() };
  if (!databaseEnabled()) return demoEnqueue(base);
  const result = await query<any>(`insert into jobs (id,tenant_id,channel_id,source_video_id,source_title,source_url,status,progress,detected_at,deadline_at)
    values ($1,$2,$3,$4,$5,$6,'queued',0,$7,$8) on conflict (tenant_id,source_video_id) do update set source_title=excluded.source_title returning *`, [randomUUID(), base.tenantId, base.channelId, base.sourceVideoId, base.sourceTitle, base.sourceUrl, base.detectedAt, base.deadlineAt]);
  return mapJob(result.rows[0]);
}

export async function leaseNextJob(workerId: string) {
  if (!databaseEnabled()) {
    const job = demoStore().jobs.find((j) => j.status === 'queued' || (j.leaseExpiresAt && new Date(j.leaseExpiresAt) < new Date()));
    if (!job) return null;
    Object.assign(job, { status: 'downloading', progress: 5, startedAt: job.startedAt || new Date().toISOString(), leaseOwner: workerId, leaseExpiresAt: new Date(Date.now() + 10 * 60000).toISOString() });
    return job;
  }
  const result = await query<any>(`with candidate as (
      select id from jobs where status='queued' or (status not in ('complete','failed') and lease_expires_at < now()) order by deadline_at asc for update skip locked limit 1
    ) update jobs set status='downloading', progress=5, started_at=coalesce(started_at,now()), lease_owner=$1, lease_expires_at=now()+interval '10 minutes'
    where id=(select id from candidate) returning *`, [workerId]);
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function updateJob(jobId: string, workerId: string, status: JobStatus, progress: number, error: string | null = null) {
  if (!databaseEnabled()) {
    const job = demoStore().jobs.find((j) => j.id === jobId && j.leaseOwner === workerId);
    if (!job) throw new Error('Job lease not found');
    Object.assign(job, { status, progress, error, leaseExpiresAt: new Date(Date.now() + 10 * 60000).toISOString(), completedAt: ['complete', 'failed'].includes(status) ? new Date().toISOString() : null });
    return job;
  }
  const result = await query<any>(`update jobs set status=$3,progress=$4,error=$5,lease_expires_at=now()+interval '10 minutes',completed_at=case when $3 in ('complete','failed') then now() else completed_at end where id=$1 and lease_owner=$2 returning *`, [jobId, workerId, status, progress, error]);
  if (!result.rows[0]) throw new Error('Job lease not found');
  return mapJob(result.rows[0]);
}

export async function channelRefreshToken(channelId: string) {
  if (!databaseEnabled()) return demoStore().channels.find((c) => c.id === channelId)?.refreshTokenEncrypted || null;
  const result = await query<{ refresh_token_encrypted: string }>('select refresh_token_encrypted from channels where id=$1', [channelId]);
  return result.rows[0]?.refresh_token_encrypted || null;
}

export async function replaceJobClips(jobId: string, clips: Array<{ title: string; durationSeconds: number; youtubeVideoId: string; youtubeUrl: string }>) {
  if (!databaseEnabled()) {
    const job = demoStore().jobs.find((j) => j.id === jobId);
    if (job) job.clips = clips.map((clip) => ({ ...clip, id: randomUUID(), jobId, status: 'uploaded' }));
    return;
  }
  for (const clip of clips) await query(`insert into clips (id,job_id,title,duration_seconds,youtube_video_id,youtube_url,status) values ($1,$2,$3,$4,$5,$6,'uploaded') on conflict (job_id,youtube_video_id) do nothing`, [randomUUID(), jobId, clip.title, clip.durationSeconds, clip.youtubeVideoId, clip.youtubeUrl]);
}

export async function monitoredSourceChannels() {
  if (!databaseEnabled()) return demoStore().sourceChannels.filter((channel) => channel.connected);
  const result = await query<any>('select * from source_channels where connected=true order by coalesce(last_polled_at, to_timestamp(0)) asc');
  return result.rows.map(mapSourceChannel);
}

export async function markSourceChannelPolled(channelId: string) {
  if (!databaseEnabled()) return;
  await query('update source_channels set last_polled_at=now() where id=$1', [channelId]);
}
