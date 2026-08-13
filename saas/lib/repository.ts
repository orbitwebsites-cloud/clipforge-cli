import { randomBytes, randomUUID } from 'node:crypto';
import { databaseEnabled, query } from './db';
import { demoAddChannel, demoAddSourceChannel, demoDashboard, demoEnqueue, demoStore } from './demo-store';
import type { Channel, DashboardData, Job, JobStatus, StoredChannel, StoredSourceChannel } from './types';

export async function getDashboard(tenantId: string): Promise<DashboardData> {
  if (!databaseEnabled()) return demoDashboard(tenantId);
  await resetMonthlyUsage(tenantId);
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
  const targetMinutes = tenant.plan === 'free' ? 1440 : 180;
  return {
    tenant: { id: tenant.id, name: tenant.name, email: tenant.email, plan: tenant.plan, subscriptionStatus: tenant.subscription_status, stripeCustomerId: tenant.stripe_customer_id, clipsThisMonth: Number(tenant.clips_this_month), monthlyClipLimit: Number(tenant.monthly_clip_limit), sourceChannelLimit: Number(tenant.source_channel_limit), complimentaryCreator: Boolean(tenant.complimentary_creator) },
    channels: channelResult.rows.map(mapChannel).map(publicChannel),
    sourceChannels: sourceResult.rows.map(mapSourceChannel).map(publicSourceChannel), jobs,
    sla: { targetMinutes, deliveredOnTimePercent: minutes.length ? Math.round(100 * minutes.filter((m) => m <= targetMinutes).length / minutes.length) : 100, averageMinutes: minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : 0 },
  };
}

export async function ensureTenant(id: string, profile: { email: string; name: string }) {
  const complimentary = complimentaryCreatorEmails().has(profile.email.toLowerCase());
  if (!databaseEnabled()) {
    const store = demoStore();
    const existing = store.tenants.find((tenant) => tenant.id === id || tenant.email === profile.email);
    if (existing) {
      if (complimentary) Object.assign(existing, { plan: 'creator', subscriptionStatus: 'active', monthlyClipLimit: 150, sourceChannelLimit: 5, complimentaryCreator: true });
      return existing;
    }
    const tenant = { id, name: profile.name, email: profile.email, plan: complimentary ? 'creator' as const : 'free' as const, subscriptionStatus: 'active' as const, stripeCustomerId: null, clipsThisMonth: 0, monthlyClipLimit: complimentary ? 150 : 10, sourceChannelLimit: complimentary ? 5 : 1, complimentaryCreator: complimentary };
    store.tenants.push(tenant); return tenant;
  }
  const result = await query<any>(`insert into tenants (id,name,email,plan,subscription_status,monthly_clip_limit,source_channel_limit,complimentary_creator)
    values ($1,$2,$3,case when $4 then 'creator' else 'free' end,'active',case when $4 then 150 else 10 end,case when $4 then 5 else 1 end,$4)
    on conflict (email) do update set name=excluded.name,
      plan=case when tenants.complimentary_creator or excluded.complimentary_creator then 'creator' else tenants.plan end,
      subscription_status=case when tenants.complimentary_creator or excluded.complimentary_creator then 'active' else tenants.subscription_status end,
      monthly_clip_limit=case when tenants.complimentary_creator or excluded.complimentary_creator then 150 else tenants.monthly_clip_limit end,
      source_channel_limit=case when tenants.complimentary_creator or excluded.complimentary_creator then 5 else tenants.source_channel_limit end,
      complimentary_creator=tenants.complimentary_creator or excluded.complimentary_creator returning *`, [id, profile.name, profile.email, complimentary]);
  return result.rows[0];
}

const complimentaryCreatorEmails = () => new Set((process.env.COMPLIMENTARY_CREATOR_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));

async function resetMonthlyUsage(tenantId?: string) {
  if (!databaseEnabled()) return;
  await query(`update tenants set clips_this_month=0,usage_month=date_trunc('month',now())::date
    where usage_month < date_trunc('month',now())::date${tenantId ? ' and id=$1' : ''}`, tenantId ? [tenantId] : []);
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
    const tenant = demoStore().tenants.find((item) => item.id === tenantId);
    const count = demoStore().sourceChannels.filter((source) => source.tenantId === tenantId).length;
    if (!tenant || count >= tenant.sourceChannelLimit) throw new Error(`${tenant?.plan === 'creator' ? 'Creator' : 'Free'} plan allows ${tenant?.sourceChannelLimit || 1} source channel${(tenant?.sourceChannelLimit || 1) === 1 ? '' : 's'}.`);
    return demoAddSourceChannel(tenantId, { ...input, destinationChannelId, connected: true, webhookSecret });
  }
  const existing = await query<any>('select * from source_channels where tenant_id=$1 and youtube_channel_id=$2', [tenantId, input.youtubeChannelId]);
  if (existing.rows[0]) return mapSourceChannel(existing.rows[0]);
  const allowance = await query<any>(`select t.plan,t.source_channel_limit,count(s.id)::int as source_count
    from tenants t left join source_channels s on s.tenant_id=t.id where t.id=$1 group by t.id`, [tenantId]);
  const limits = allowance.rows[0];
  if (!limits) throw new Error('Account not found');
  if (Number(limits.source_count) >= Number(limits.source_channel_limit)) throw new Error(`${limits.plan === 'creator' ? 'Creator' : 'Free'} plan allows ${limits.source_channel_limit} source channel${Number(limits.source_channel_limit) === 1 ? '' : 's'}.`);
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
  const plan = databaseEnabled()
    ? (await query<{ plan: string }>('select plan from tenants where id=$1', [source.tenantId])).rows[0]?.plan
    : demoStore().tenants.find((tenant) => tenant.id === source.tenantId)?.plan;
  const targetMinutes = plan === 'free' ? 1440 : 180;
  const base = { tenantId: source.tenantId, channelId: source.destinationChannelId, sourceVideoId: video.id, sourceTitle: video.title, sourceUrl: `https://youtube.com/watch?v=${video.id}`, detectedAt: detectedAt.toISOString(), deadlineAt: new Date(detectedAt.getTime() + targetMinutes * 60000).toISOString() };
  if (!databaseEnabled()) return demoEnqueue(base);
  const result = await query<any>(`insert into jobs (id,tenant_id,channel_id,source_video_id,source_title,source_url,status,progress,detected_at,deadline_at)
    values ($1,$2,$3,$4,$5,$6,'queued',0,$7,$8) on conflict (tenant_id,source_video_id) do update set source_title=excluded.source_title returning *`, [randomUUID(), base.tenantId, base.channelId, base.sourceVideoId, base.sourceTitle, base.sourceUrl, base.detectedAt, base.deadlineAt]);
  return mapJob(result.rows[0]);
}

export async function leaseNextJob(workerId: string) {
  if (!databaseEnabled()) {
    const job = demoStore().jobs.find((j) => {
      const tenant = demoStore().tenants.find((item) => item.id === j.tenantId);
      return Boolean(tenant && tenant.clipsThisMonth < tenant.monthlyClipLimit && (j.status === 'queued' || (j.leaseExpiresAt && new Date(j.leaseExpiresAt) < new Date())));
    });
    if (!job) return null;
    const tenant = demoStore().tenants.find((item) => item.id === job.tenantId)!;
    Object.assign(job, { status: 'downloading', progress: 5, startedAt: job.startedAt || new Date().toISOString(), leaseOwner: workerId, leaseExpiresAt: new Date(Date.now() + 10 * 60000).toISOString() });
    return { ...job, maxUploads: tenant.monthlyClipLimit - tenant.clipsThisMonth };
  }
  await resetMonthlyUsage();
  const result = await query<any>(`with candidate as (
      select j.id,t.monthly_clip_limit-t.clips_this_month as max_uploads from jobs j join tenants t on t.id=j.tenant_id
      where t.clips_this_month<t.monthly_clip_limit and (j.status='queued' or (j.status not in ('complete','failed') and j.lease_expires_at < now()))
      order by case when t.plan in ('creator','studio') then 0 else 1 end,j.deadline_at asc for update of j skip locked limit 1
    ) update jobs set status='downloading', progress=5, started_at=coalesce(started_at,now()), lease_owner=$1, lease_expires_at=now()+interval '10 minutes'
    from candidate where jobs.id=candidate.id returning jobs.*,candidate.max_uploads`, [workerId]);
  return result.rows[0] ? { ...mapJob(result.rows[0]), maxUploads: Number(result.rows[0].max_uploads) } : null;
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
    if (job) {
      const tenant = demoStore().tenants.find((item) => item.id === job.tenantId);
      const accepted = clips.slice(0, Math.max(0, (tenant?.monthlyClipLimit || 0) - (tenant?.clipsThisMonth || 0)));
      job.clips = accepted.map((clip) => ({ ...clip, id: randomUUID(), jobId, status: 'uploaded' }));
      if (tenant) tenant.clipsThisMonth += accepted.length;
    }
    return;
  }
  let inserted = 0;
  for (const clip of clips) {
    const result = await query(`insert into clips (id,job_id,title,duration_seconds,youtube_video_id,youtube_url,status) values ($1,$2,$3,$4,$5,$6,'uploaded') on conflict (job_id,youtube_video_id) do nothing`, [randomUUID(), jobId, clip.title, clip.durationSeconds, clip.youtubeVideoId, clip.youtubeUrl]);
    inserted += result.rowCount || 0;
  }
  if (inserted) await query(`update tenants t set clips_this_month=least(t.monthly_clip_limit,t.clips_this_month+$2)
    from jobs j where j.id=$1 and t.id=j.tenant_id`, [jobId, inserted]);
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
