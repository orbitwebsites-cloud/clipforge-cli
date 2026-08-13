export type Plan = 'free' | 'creator' | 'studio';
export type JobStatus = 'queued' | 'downloading' | 'transcribing' | 'selecting' | 'rendering' | 'uploading' | 'complete' | 'failed';

export type Channel = {
  id: string;
  tenantId: string;
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  sourceUrl: string;
  connected: boolean;
  createdAt: string;
};

export type StoredChannel = Channel & {
  webhookSecret: string;
  refreshTokenEncrypted: string;
};

export type SourceChannel = {
  id: string;
  tenantId: string;
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  url: string;
  connected: boolean;
  createdAt: string;
};

export type StoredSourceChannel = SourceChannel & {
  webhookSecret: string;
  destinationChannelId: string;
};

export type Clip = {
  id: string;
  jobId: string;
  title: string;
  durationSeconds: number;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  status: 'rendered' | 'uploaded' | 'failed';
};

export type Job = {
  id: string;
  tenantId: string;
  channelId: string;
  sourceVideoId: string;
  sourceTitle: string;
  sourceUrl: string;
  status: JobStatus;
  progress: number;
  detectedAt: string;
  deadlineAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  clips: Clip[];
};

export type Tenant = {
  id: string;
  name: string;
  email: string;
  plan: Plan;
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'canceled';
  stripeCustomerId: string | null;
  clipsThisMonth: number;
  monthlyClipLimit: number;
  sourceChannelLimit: number;
  complimentaryCreator: boolean;
};

export type DashboardData = {
  tenant: Tenant;
  channels: Channel[];
  sourceChannels: SourceChannel[];
  jobs: Job[];
  sla: { targetMinutes: number; deliveredOnTimePercent: number; averageMinutes: number };
};
