import { randomUUID } from 'node:crypto';
import type { Channel, DashboardData, Job, SourceChannel, StoredChannel, StoredSourceChannel, Tenant } from './types';

type DemoStore = { tenants: Tenant[]; channels: StoredChannel[]; sourceChannels: StoredSourceChannel[]; jobs: Job[] };
const globalStore = globalThis as typeof globalThis & { __clipforgeStore?: DemoStore };

export const DEMO_TENANT_ID = 'tenant_demo';

export function demoStore(): DemoStore {
  if (!globalStore.__clipforgeStore) {
    globalStore.__clipforgeStore = {
      tenants: [{ id: DEMO_TENANT_ID, name: 'New creator', email: 'creator@example.com', plan: 'trial', subscriptionStatus: 'trialing', stripeCustomerId: null, clipsThisMonth: 0, monthlyClipLimit: 15 }],
      channels: [],
      sourceChannels: [],
      jobs: [],
    };
  }
  return globalStore.__clipforgeStore;
}

export function demoDashboard(tenantId = DEMO_TENANT_ID): DashboardData {
  const store = demoStore();
  const tenant = store.tenants.find((item) => item.id === tenantId);
  if (!tenant) throw new Error('Tenant not found');
  const channels: Channel[] = store.channels.filter((item) => item.tenantId === tenant.id).map(({ webhookSecret: _webhookSecret, refreshTokenEncrypted: _refreshToken, ...channel }) => channel);
  const sourceChannels: SourceChannel[] = store.sourceChannels.filter((item) => item.tenantId === tenant.id).map(({ webhookSecret: _secret, destinationChannelId: _destination, ...channel }) => channel);
  return { tenant, channels, sourceChannels, jobs: store.jobs.filter((item) => item.tenantId === tenant.id).sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)), sla: { targetMinutes: 180, deliveredOnTimePercent: 100, averageMinutes: 0 } };
}

export function demoAddChannel(tenantId: string, data: Omit<StoredChannel, 'id' | 'tenantId' | 'createdAt'>) {
  const channel: StoredChannel = { ...data, id: randomUUID(), tenantId, createdAt: new Date().toISOString() };
  demoStore().channels.push(channel);
  return channel;
}

export function demoAddSourceChannel(tenantId: string, data: Omit<StoredSourceChannel, 'id' | 'tenantId' | 'createdAt'>) {
  const source: StoredSourceChannel = { ...data, id: randomUUID(), tenantId, createdAt: new Date().toISOString() };
  demoStore().sourceChannels.push(source);
  return source;
}

export function demoEnqueue(input: Omit<Job, 'id' | 'clips' | 'progress' | 'status' | 'startedAt' | 'completedAt' | 'error'>) {
  const duplicate = demoStore().jobs.find((job) => job.tenantId === input.tenantId && job.sourceVideoId === input.sourceVideoId);
  if (duplicate) return duplicate;
  const job: Job = { ...input, id: randomUUID(), clips: [], progress: 0, status: 'queued', startedAt: null, completedAt: null, error: null };
  demoStore().jobs.push(job);
  return job;
}
