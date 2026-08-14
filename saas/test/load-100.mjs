import { performance } from 'node:perf_hooks';
import { register } from 'node:module';

register('./ts-extension-loader.mjs', import.meta.url);

const baseUrl = process.env.LOAD_BASE_URL || 'http://127.0.0.1:3100';
const users = Math.max(1, Number(process.env.LOAD_USERS || 100));
const healthRequestsPerUser = Math.max(1, Number(process.env.LOAD_REQUESTS_PER_USER || 20));

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(1));
};

async function httpLoad(path, requestsPerUser) {
  const timings = [];
  const statuses = {};
  const errors = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = performance.now();
  const clients = Array.from({ length: users }, (_, user) => (async () => {
    await gate;
    for (let request = 0; request < requestsPerUser; request++) {
      const at = performance.now();
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          redirect: 'manual',
          signal: AbortSignal.timeout(15_000),
          headers: { 'x-load-test-user': String(user) },
        });
        await response.arrayBuffer();
        timings.push(performance.now() - at);
        statuses[response.status] = (statuses[response.status] || 0) + 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  })());
  release();
  await Promise.all(clients);
  const elapsedMs = performance.now() - started;
  return {
    path,
    users,
    requests: users * requestsPerUser,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    requestsPerSecond: Number(((users * requestsPerUser) / (elapsedMs / 1000)).toFixed(1)),
    statuses,
    errors: errors.length,
    sampleError: errors[0] || null,
    latencyMs: {
      p50: percentile(timings, 0.50),
      p95: percentile(timings, 0.95),
      p99: percentile(timings, 0.99),
      max: timings.length ? Number(Math.max(...timings).toFixed(1)) : null,
    },
  };
}

function tenant(id, monthlyClipLimit = 10) {
  return {
    id,
    name: id,
    email: `${id}@load.test`,
    plan: 'creator',
    subscriptionStatus: 'active',
    stripeCustomerId: null,
    clipsThisMonth: 0,
    monthlyClipLimit,
    sourceChannelLimit: 5,
    complimentaryCreator: false,
  };
}

function source(tenantId) {
  return {
    id: `source_${tenantId}`,
    tenantId,
    destinationChannelId: `destination_${tenantId}`,
    youtubeChannelId: `UC_${tenantId}`,
    platform: 'youtube',
    platformUserId: `UC_${tenantId}`,
    platformLogin: tenantId,
    title: tenantId,
    handle: `@${tenantId}`,
    url: `https://youtube.com/@${tenantId}`,
    connected: true,
    rightsConfirmed: true,
    webhookSecret: `secret_${tenantId}`,
    createdAt: new Date().toISOString(),
  };
}

async function repositoryLoad() {
  delete process.env.DATABASE_URL;
  const [{ demoStore }, repository] = await Promise.all([
    import('../lib/demo-store.ts'),
    import('../lib/repository.ts'),
  ]);
  const store = demoStore();
  const reset = () => {
    store.tenants.length = 0;
    store.channels.length = 0;
    store.sourceChannels.length = 0;
    store.jobs.length = 0;
  };

  const before = process.memoryUsage().heapUsed;
  reset();
  const sources = Array.from({ length: users }, (_, index) => {
    const id = `tenant_${index}`;
    store.tenants.push(tenant(id));
    const item = source(id);
    store.sourceChannels.push(item);
    return item;
  });
  await Promise.all(sources.map((item, index) => repository.enqueueVideo(item, {
    id: `video_${index}`,
    title: `Video ${index}`,
  })));
  const leases = await Promise.all(Array.from({ length: users }, (_, index) => repository.leaseNextJob(`worker_${index}`)));
  const leaseIds = leases.filter(Boolean).map((job) => job.id);
  const distinctTenantResult = {
    jobs: store.jobs.length,
    leases: leaseIds.length,
    uniqueLeases: new Set(leaseIds).size,
  };

  reset();
  const duplicateTenant = tenant('tenant_duplicate');
  const duplicateSource = source(duplicateTenant.id);
  store.tenants.push(duplicateTenant);
  store.sourceChannels.push(duplicateSource);
  await Promise.all(Array.from({ length: users }, () => repository.enqueueVideo(duplicateSource, {
    id: 'same_video',
    title: 'Same video webhook retry',
  })));
  const idempotencyResult = { attempts: users, jobs: store.jobs.length };

  reset();
  const crowdedTenant = tenant('tenant_crowded', 10);
  const crowdedSource = source(crowdedTenant.id);
  store.tenants.push(crowdedTenant);
  store.sourceChannels.push(crowdedSource);
  await Promise.all(Array.from({ length: users }, (_, index) => repository.enqueueVideo(crowdedSource, {
    id: `crowded_video_${index}`,
    title: `Crowded video ${index}`,
  })));
  const crowdedLeases = (await Promise.all(Array.from({ length: users }, (_, index) => repository.leaseNextJob(`crowded_worker_${index}`)))).filter(Boolean);
  const sameTenantOversubscription = {
    monthlyClipLimit: crowdedTenant.monthlyClipLimit,
    jobsLeased: crowdedLeases.length,
    maxUploadsGranted: crowdedLeases.reduce((sum, job) => sum + Number(job.maxUploads || 0), 0),
    likelyUploadsAtThreeClipsPerJob: crowdedLeases.length * 3,
  };

  reset();
  const expiryTenant = tenant('tenant_expiry');
  const expirySource = source(expiryTenant.id);
  store.tenants.push(expiryTenant);
  store.sourceChannels.push(expirySource);
  await repository.enqueueVideo(expirySource, { id: 'expiry_video', title: 'Expiry video' });
  const firstLease = await repository.leaseNextJob('worker_before_expiry');
  const leasedJob = store.jobs.find((job) => job.id === firstLease.id);
  leasedJob.leaseExpiresAt = new Date(Date.now() - 1000).toISOString();
  const secondLease = await repository.leaseNextJob('worker_after_expiry');
  let staleWorkerRejected = false;
  try {
    await repository.updateJob(firstLease.id, 'worker_before_expiry', 'uploading', 84);
  } catch {
    staleWorkerRejected = true;
  }
  const expiryResult = {
    sameJobReLeased: firstLease.id === secondLease?.id,
    staleWorkerRejectedOnNextProgress: staleWorkerRejected,
    externalSideEffectsFenced: false,
  };

  return {
    distinctTenants: distinctTenantResult,
    duplicateWebhook: idempotencyResult,
    sameTenantOversubscription,
    expiredLease: expiryResult,
    heapGrowthMB: Number(((process.memoryUsage().heapUsed - before) / 1048576).toFixed(2)),
  };
}

const result = {
  generatedAt: new Date().toISOString(),
  target: baseUrl,
  http: [],
  repository: null,
};

for (const [path, requests] of [
  ['/api/health', healthRequestsPerUser],
  ['/', 1],
  ['/dashboard', 1],
  ['/api/dashboard', 1],
]) {
  result.http.push(await httpLoad(path, requests));
}
result.repository = await repositoryLoad();
console.log(JSON.stringify(result, null, 2));
