export type Plan = 'free' | 'creator' | 'clipping' | 'studio';
export type SourcePlatform = 'youtube' | 'twitch';
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
  platform: SourcePlatform;
  platformUserId: string;
  platformLogin: string | null;
  title: string;
  handle: string | null;
  url: string;
  connected: boolean;
  rightsConfirmed: boolean;
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
  status: 'rendered' | 'review' | 'uploaded' | 'failed';
  privacyStatus: 'public' | 'private' | null;
};

export type CreatorPreferences = {
  publishMode: 'automatic' | 'review';
  clipsPerVideo: number;
  minClipSeconds: number;
  maxClipSeconds: number;
  captionStyle: 'impact' | 'clean' | 'minimal';
  brandColor: string;
  hashtags: string;
  learningEnabled: boolean;
  autoDeleteEnabled: boolean;
  autoDeleteMinViews: number;
  autoDeleteAfterHours: number;
};

export type PastVideo = {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  thumbnailUrl: string | null;
  platform: SourcePlatform;
  alreadyQueued?: boolean;
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
  preferences: CreatorPreferences;
  sla: { targetMinutes: number; deliveredOnTimePercent: number; averageMinutes: number };
};

export type ChannelAnalytics = {
  source: 'youtube';
  rangeDays: 7 | 28 | 90;
  startDate: string;
  endDate: string;
  syncedAt: string;
  summary: {
    views: number;
    watchMinutes: number;
    averageViewDuration: number;
    likes: number;
    comments: number;
    subscribersGained: number;
    subscribersLost: number;
    netSubscribers: number;
    engagementRate: number;
  };
  channelTotals: {
    subscribers: number | null;
    lifetimeViews: number;
    videos: number;
  };
  trend: Array<{
    date: string;
    views: number;
    watchMinutes: number;
    subscribersGained: number;
    subscribersLost: number;
  }>;
  shorts: Array<{
    videoId: string;
    title: string;
    url: string;
    views: number;
    watchMinutes: number;
    averageViewDuration: number;
    likes: number;
    comments: number;
    subscribersGained: number;
    durationSeconds: number;
  }>;
};
