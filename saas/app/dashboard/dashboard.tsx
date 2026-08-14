'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { UserButton, UserProfile } from '@clerk/nextjs';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Captions,
  Check,
  CircleUserRound,
  Clock3,
  CreditCard,
  ExternalLink,
  Eye,
  Gauge,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  MessageCircle,
  Palette,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Rocket,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  ThumbsUp,
  Timer,
  Trash2,
  TrendingUp,
  Tv,
  UploadCloud,
  Users,
  WandSparkles,
} from 'lucide-react';
import type {
  ChannelAnalytics,
  CreatorPreferences,
  DashboardData,
  Job,
  JobStatus,
  PastVideo,
} from '@/lib/types';

const statusLabels: Record<JobStatus, string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  transcribing: 'Transcribing',
  selecting: 'Selecting moments',
  rendering: 'Rendering clips',
  uploading: 'Publishing',
  complete: 'Published',
  failed: 'Needs attention',
};
const stageOrder: JobStatus[] = [
  'downloading',
  'transcribing',
  'selecting',
  'rendering',
  'uploading',
  'complete',
];
type DashboardTab =
  | 'overview'
  | 'analytics'
  | 'jobs'
  | 'clips'
  | 'sources'
  | 'profile'
  | 'billing'
  | 'settings';
type LibraryVideo = PastVideo & { sourceId: string; sourceTitle: string };
const dashboardTabs = new Set<DashboardTab>([
  'overview',
  'analytics',
  'jobs',
  'clips',
  'sources',
  'profile',
  'billing',
  'settings',
]);

function relative(value: string) {
  const minutes = Math.max(
    1,
    Math.round((Date.now() - new Date(value).getTime()) / 60000),
  );
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

export default function Dashboard({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial);
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [sourceUrl, setSourceUrl] = useState('');
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const destination = data.channels[0];
  const active = data.jobs.find(
    (job) => !['complete', 'failed'].includes(job.status),
  );
  const completedClips = data.jobs
    .flatMap((job) => job.clips)
    .filter((clip) => ['uploaded', 'review'].includes(clip.status));
  const deadlineRemaining = active
    ? Math.max(0, new Date(active.deadlineAt).getTime() - Date.now())
    : 0;
  const remainingLabel = useMemo(
    () =>
      `${String(Math.floor(deadlineRemaining / 3600000)).padStart(2, '0')}:${String(Math.floor((deadlineRemaining % 3600000) / 60000)).padStart(2, '0')}`,
    [deadlineRemaining],
  );

  useEffect(() => {
    const syncTab = () => {
      const requested = new URLSearchParams(window.location.search).get(
        'tab',
      ) as DashboardTab | null;
      if (requested && dashboardTabs.has(requested)) setActiveTab(requested);
    };
    syncTab();
    window.addEventListener('popstate', syncTab);
    return () => window.removeEventListener('popstate', syncTab);
  }, []);

  function navigate(tab: DashboardTab) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.pushState({}, '', url);
  }

  async function addSource(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice('');
    const response = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: sourceUrl, rightsConfirmed }),
    });
    const body = await response.json();
    setSaving(false);
    setNotice(
      response.ok
        ? body.message || 'Source connected. New uploads are now monitored.'
        : body.error || 'Could not connect source.',
    );
    if (body.dashboard) {
      setData(body.dashboard);
      setSourceUrl('');
      setRightsConfirmed(false);
    }
  }

  async function removeSource(id: string) {
    setSaving(true);
    setNotice('');
    const response = await fetch('/api/channels', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const body = await response.json();
    setSaving(false);
    if (body.dashboard) setData(body.dashboard);
    if (!response.ok) setNotice(body.error || 'Could not remove source.');
  }

  async function startCheckout(
    plan: 'creator' | 'clipping',
    billingCycle: 'monthly' | 'annual' = 'monthly',
  ) {
    setSaving(true);
    const response = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan, billingCycle }),
    });
    const body = await response.json();
    setSaving(false);
    if (body.url) window.location.href = body.url;
  }

  async function publishClip(clipId: string) {
    setSaving(true);
    setNotice('');
    const response = await fetch('/api/clips/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clipId }),
    });
    const body = await response.json();
    setSaving(false);
    if (!response.ok)
      return setNotice(body.error || 'Short could not be published.');
    setData((current) => ({
      ...current,
      jobs: current.jobs.map((job) => ({
        ...job,
        clips: job.clips.map((clip) =>
          clip.id === clipId
            ? { ...clip, status: 'uploaded', privacyStatus: 'public' }
            : clip,
        ),
      })),
    }));
    setNotice('Short published to YouTube.');
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <Play size={15} fill="currentColor" />
          </span>
          ClipForge <em>Cloud</em>
        </Link>
        <nav className="side-nav">
          <button
            className={activeTab === 'overview' ? 'active' : ''}
            onClick={() => navigate('overview')}
          >
            <LayoutDashboard /> Overview
          </button>
          <button
            className={activeTab === 'analytics' ? 'active' : ''}
            onClick={() => navigate('analytics')}
            disabled={!destination}
          >
            <BarChart3 /> Analytics
          </button>
          <button
            className={activeTab === 'jobs' ? 'active' : ''}
            onClick={() => navigate('jobs')}
            disabled={!destination}
          >
            <Activity /> Jobs <span>{data.jobs.length}</span>
          </button>
          <button
            className={activeTab === 'clips' ? 'active' : ''}
            onClick={() => navigate('clips')}
            disabled={!destination}
          >
            <Captions /> Clips
          </button>
          <button
            className={activeTab === 'sources' ? 'active' : ''}
            onClick={() => navigate('sources')}
            disabled={!destination}
          >
            <Tv /> Sources <span>{data.sourceChannels.length}</span>
          </button>
        </nav>
        <div className="side-bottom">
          <button
            className={activeTab === 'profile' ? 'active' : ''}
            onClick={() => navigate('profile')}
          >
            <CircleUserRound /> Profile
          </button>
          <button
            className={`upgrade-nav ${activeTab === 'billing' ? 'active' : ''}`}
            onClick={() => navigate('billing')}
          >
            <Rocket /> Upgrade plan <ArrowRight />
          </button>
          <button
            className={activeTab === 'settings' ? 'active' : ''}
            onClick={() => navigate('settings')}
          >
            <Settings /> Settings
          </button>
          <div className="account-chip">
            <UserButton />
            <div>
              <b>{data.tenant.name}</b>
              <small>{data.tenant.email}</small>
            </div>
          </div>
        </div>
      </aside>

      <section className="app-main">
        <nav className="mobile-tabs" aria-label="Dashboard tabs">
          {(
            [
              'overview',
              'analytics',
              'jobs',
              'clips',
              'sources',
              'profile',
              'billing',
              'settings',
            ] as DashboardTab[]
          ).map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? 'active' : ''}
              onClick={() => navigate(tab)}
              disabled={
                !destination &&
                ['analytics', 'jobs', 'clips', 'sources'].includes(tab)
              }
            >
              {tab === 'billing' ? 'Upgrade' : tab}
            </button>
          ))}
        </nav>

        {activeTab === 'profile' ? (
          <ProfilePanel data={data} />
        ) : activeTab === 'settings' ? (
          <SettingsPanel
            initial={data.preferences}
            onSaved={(dashboard) => setData(dashboard)}
          />
        ) : activeTab === 'billing' ? (
          <BillingPanel
            data={data}
            saving={saving}
            startCheckout={startCheckout}
          />
        ) : !destination ? (
          <EmptyOnboarding name={data.tenant.name} />
        ) : (
          <>
            <header className="app-header">
              <div>
                <p className="overline">
                  {activeTab === 'overview'
                    ? 'Creator workspace'
                    : 'Workspace tab'}
                </p>
                <h1>
                  {activeTab === 'overview'
                    ? destination.title
                    : activeTab[0].toUpperCase() + activeTab.slice(1)}
                </h1>
                <p>
                  {activeTab === 'overview'
                    ? `Shorts publish here. Your ${data.tenant.plan} plan supports ${data.tenant.sourceChannelLimit} source channels.`
                    : `A focused view of your ${activeTab}.`}
                </p>
              </div>
              <div className="header-actions">
                <span className="live-chip">
                  <i /> Destination connected
                </span>
                <button
                  className="button button-dark"
                  onClick={() => navigate('sources')}
                >
                  <Plus size={17} /> Add source
                </button>
              </div>
            </header>

            {activeTab === 'overview' &&
              (!data.sourceChannels.length ? (
                <SourceOnboarding
                  destination={destination.title}
                  sourceUrl={sourceUrl}
                  setSourceUrl={setSourceUrl}
                  rightsConfirmed={rightsConfirmed}
                  setRightsConfirmed={setRightsConfirmed}
                  addSource={addSource}
                  saving={saving}
                  notice={notice}
                />
              ) : (
                <>
                  <div className="metrics-grid">
                    <article>
                      <div>
                        <span className="metric-icon green">
                          <Gauge />
                        </span>
                        <small>SLA delivery</small>
                      </div>
                      <b>{data.sla.deliveredOnTimePercent}%</b>
                      <p>within 3 hours</p>
                    </article>
                    <article>
                      <div>
                        <span className="metric-icon purple">
                          <Captions />
                        </span>
                        <small>Clips this month</small>
                      </div>
                      <b>{data.tenant.clipsThisMonth}</b>
                      <p>of {data.tenant.monthlyClipLimit} included</p>
                    </article>
                    <article>
                      <div>
                        <span className="metric-icon orange">
                          <Clock3 />
                        </span>
                        <small>Average turnaround</small>
                      </div>
                      <b>
                        {data.sla.averageMinutes || '—'}
                        {data.sla.averageMinutes ? 'm' : ''}
                      </b>
                      <p>from detection to live</p>
                    </article>
                    <article>
                      <div>
                        <span className="metric-icon red">
                          <Radio />
                        </span>
                        <small>Source channels</small>
                      </div>
                      <b>{data.sourceChannels.length}</b>
                      <p>actively monitored</p>
                    </article>
                  </div>
                  {active && (
                    <ActiveJob
                      job={active}
                      remainingLabel={remainingLabel}
                      targetMinutes={data.sla.targetMinutes}
                    />
                  )}
                </>
              ))}
            {activeTab === 'analytics' && (
              <AnalyticsPanel destinationId={destination.id} />
            )}
            {activeTab === 'jobs' && (
              <JobsPanel
                jobs={data.jobs}
                active={active}
                remainingLabel={remainingLabel}
                targetMinutes={data.sla.targetMinutes}
              />
            )}
            {activeTab === 'clips' && (
              <ClipsPanel
                clips={completedClips}
                saving={saving}
                publishClip={publishClip}
              />
            )}
            {activeTab === 'sources' && (
              <SourcesPanel
                data={data}
                onDashboard={setData}
                onOpenJobs={() => navigate('jobs')}
                sourceUrl={sourceUrl}
                setSourceUrl={setSourceUrl}
                rightsConfirmed={rightsConfirmed}
                setRightsConfirmed={setRightsConfirmed}
                addSource={addSource}
                removeSource={removeSource}
                saving={saving}
                notice={notice}
              />
            )}
          </>
        )}
      </section>
    </main>
  );
}

function ActiveJob({
  job,
  remainingLabel,
  targetMinutes,
}: {
  job: Job;
  remainingLabel: string;
  targetMinutes: number;
}) {
  return (
    <article className="active-job">
      <div className="active-top">
        <div>
          <span className="status-badge">
            <LoaderCircle className="spin" /> Processing now
          </span>
          <h2>{job.sourceTitle}</h2>
          <p>
            Detected {relative(job.detectedAt)} · {statusLabels[job.status]}
          </p>
        </div>
        <div className="deadline">
          <small>Time remaining</small>
          <b>{remainingLabel}</b>
          <span>
            {targetMinutes === 180
              ? 'Priority · 3-hour target'
              : 'Standard queue'}
          </span>
        </div>
      </div>
      <div className="progress-track">
        <i style={{ width: `${job.progress}%` }} />
      </div>
      <div className="stages">
        {stageOrder.map((stage, index) => {
          const current = stageOrder.indexOf(job.status);
          const done = current > index || job.status === 'complete';
          return (
            <div
              className={done ? 'done' : current === index ? 'current' : ''}
              key={stage}
            >
              <span>{done ? <Check /> : index + 1}</span>
              <b>{statusLabels[stage]}</b>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function JobsPanel({
  jobs,
  active,
  remainingLabel,
  targetMinutes,
}: {
  jobs: Job[];
  active?: Job;
  remainingLabel: string;
  targetMinutes: number;
}) {
  return (
    <section className="tab-panel jobs-tab">
      <div className="tab-heading">
        <div>
          <p className="overline">Production queue</p>
          <h2>Every clipping job</h2>
          <p>Follow each source from detection through publishing.</p>
        </div>
        <span className="tab-count">{jobs.length} total</span>
      </div>
      {active && (
        <ActiveJob
          job={active}
          remainingLabel={remainingLabel}
          targetMinutes={targetMinutes}
        />
      )}
      <div className="job-history">
        {jobs.length ? (
          jobs.map((job) => (
            <article key={job.id}>
              <span className={`job-status ${job.status}`}>
                <Activity />
              </span>
              <div>
                <b>{job.sourceTitle}</b>
                <p>
                  {statusLabels[job.status]} · detected{' '}
                  {relative(job.detectedAt)}
                </p>
              </div>
              <div className="job-progress">
                <span>
                  <i style={{ width: `${job.progress}%` }} />
                </span>
                <small>{job.progress}%</small>
              </div>
              <strong>
                {job.clips.length} clip{job.clips.length === 1 ? '' : 's'}
              </strong>
            </article>
          ))
        ) : (
          <div className="empty-state">
            <Activity />
            <b>No jobs yet</b>
            <p>New source uploads will enter the queue automatically.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function ClipsPanel({
  clips,
  saving,
  publishClip,
}: {
  clips: DashboardData['jobs'][number]['clips'];
  saving: boolean;
  publishClip: (clipId: string) => void;
}) {
  return (
    <section className="tab-panel">
      <div className="tab-heading">
        <div>
          <p className="overline">Content library</p>
          <h2>Published and review-ready Shorts</h2>
          <p>Open live uploads or approve private review clips.</p>
        </div>
        <span className="tab-count">{clips.length} clips</span>
      </div>
      <div className="clip-library">
        {clips.length ? (
          clips.map((clip) => (
            <article className="clip-card" key={clip.id}>
              <div className="clip-card-thumb">
                <Play fill="currentColor" />
              </div>
              <div>
                <span>
                  {clip.status === 'review'
                    ? 'PRIVATE REVIEW'
                    : 'LIVE ON YOUTUBE'}
                </span>
                <h3>{clip.title}</h3>
                <p>
                  {clip.durationSeconds}s · {clip.privacyStatus || 'processing'}
                </p>
              </div>
              <div className="clip-card-actions">
                {clip.status === 'review' && (
                  <button
                    className="button button-primary"
                    onClick={() => publishClip(clip.id)}
                    disabled={saving}
                  >
                    <Rocket /> Publish
                  </button>
                )}
                <a
                  className="button button-ghost"
                  href={clip.youtubeUrl || '#'}
                  target="_blank"
                >
                  Open <ExternalLink />
                </a>
              </div>
            </article>
          ))
        ) : (
          <div className="empty-state">
            <UploadCloud />
            <b>Your first clips will appear here</b>
            <p>We are watching your source channels for new uploads.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function SourcesPanel({
  data,
  onDashboard,
  onOpenJobs,
  sourceUrl,
  setSourceUrl,
  rightsConfirmed,
  setRightsConfirmed,
  addSource,
  removeSource,
  saving,
  notice,
}: {
  data: DashboardData;
  onDashboard: (dashboard: DashboardData) => void;
  onOpenJobs: () => void;
  sourceUrl: string;
  setSourceUrl: (value: string) => void;
  rightsConfirmed: boolean;
  setRightsConfirmed: (value: boolean) => void;
  addSource: (event: React.FormEvent) => void;
  removeSource: (id: string) => void;
  saving: boolean;
  notice: string;
}) {
  const [librarySourceIds, setLibrarySourceIds] = useState<string[]>(
    data.sourceChannels[0] ? [data.sourceChannels[0].id] : [],
  );
  const [pastVideos, setPastVideos] = useState<LibraryVideo[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryNotice, setLibraryNotice] = useState('');
  const [confirmingQueue, setConfirmingQueue] = useState(false);

  useEffect(() => {
    const connectedIds = new Set(
      data.sourceChannels.map((source) => source.id),
    );
    setLibrarySourceIds((current) => {
      const retained = current.filter((sourceId) => connectedIds.has(sourceId));
      return retained.length
        ? retained
        : data.sourceChannels[0]
          ? [data.sourceChannels[0].id]
          : [];
    });
  }, [data.sourceChannels]);

  const videoKey = (video: LibraryVideo) => `${video.sourceId}::${video.id}`;

  function resetLibrary() {
    setPastVideos([]);
    setSelectedKeys([]);
    setLibraryNotice('');
  }

  function toggleLibrarySource(sourceId: string) {
    setLibrarySourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId],
    );
    resetLibrary();
  }

  async function loadPastVideos() {
    if (!librarySourceIds.length) return;
    setLibraryLoading(true);
    setLibraryNotice('');
    setSelectedKeys([]);
    const search = new URLSearchParams({
      sourceIds: librarySourceIds.join(','),
    });
    const response = await fetch(`/api/videos/backfill?${search}`);
    const body = await response.json();
    setLibraryLoading(false);
    if (!response.ok)
      return setLibraryNotice(body.error || 'Past videos could not be loaded.');
    setPastVideos(body.videos || []);
    setLibraryNotice(
      body.videos?.length
        ? `Loaded ${body.videos.length} past videos from ${body.sources.length} channel${body.sources.length === 1 ? '' : 's'}. Choose any mix you want.`
        : 'No public past videos were found for the selected channels.',
    );
  }

  function toggleVideo(video: LibraryVideo) {
    const key = videoKey(video);
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : current.length < 20
          ? [...current, key]
          : current,
    );
  }

  async function queueSelected() {
    if (!selectedKeys.length) return;
    const selectedKeySet = new Set(selectedKeys);
    const grouped = new Map<string, string[]>();
    for (const video of pastVideos) {
      if (!selectedKeySet.has(videoKey(video))) continue;
      grouped.set(video.sourceId, [
        ...(grouped.get(video.sourceId) || []),
        video.id,
      ]);
    }
    const selections = [...grouped].map(([sourceId, videoIds]) => ({
      sourceId,
      videoIds,
    }));
    setLibraryLoading(true);
    setLibraryNotice('');
    const response = await fetch('/api/videos/backfill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selections }),
    });
    const body = await response.json();
    setLibraryLoading(false);
    if (!response.ok) {
      setConfirmingQueue(false);
      return setLibraryNotice(
        body.error || 'Selected videos could not be queued.',
      );
    }
    if (body.dashboard) onDashboard(body.dashboard);
    setPastVideos((current) =>
      current.map((video) =>
        selectedKeySet.has(videoKey(video))
          ? { ...video, alreadyQueued: true }
          : video,
      ),
    );
    setSelectedKeys([]);
    setConfirmingQueue(false);
    setLibraryNotice(
      `${body.queued} video${body.queued === 1 ? '' : 's'} queued for analysis and publishing${body.skipped ? `; ${body.skipped} already existed` : ''}.`,
    );
    onOpenJobs();
  }

  const videoRounds = useMemo(() => {
    const videosBySource = new Map<string, LibraryVideo[]>();
    for (const video of pastVideos) {
      videosBySource.set(video.sourceId, [
        ...(videosBySource.get(video.sourceId) || []),
        video,
      ]);
    }
    const creatorVideos = [...videosBySource.values()].map((videos) =>
      [...videos].sort(
        (first, second) =>
          new Date(second.publishedAt).getTime() -
          new Date(first.publishedAt).getTime(),
      ),
    );
    const roundCount = Math.max(0, ...creatorVideos.map((videos) => videos.length));
    return Array.from({ length: roundCount }, (_, rank) => ({
      rank,
      videos: creatorVideos.flatMap((videos) =>
        videos[rank] ? [videos[rank]] : [],
      ),
    })).filter((round) => round.videos.length);
  }, [pastVideos]);

  const orderedVideos = videoRounds.flatMap((round) => round.videos);
  const selectableKeys = orderedVideos
    .filter((video) => !video.alreadyQueued)
    .map(videoKey)
    .slice(0, 20);
  const selectedSourceCount = new Set(
    orderedVideos
      .filter((video) => selectedKeys.includes(videoKey(video)))
      .map((video) => video.sourceId),
  ).size;

  useEffect(() => {
    if (!confirmingQueue) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !libraryLoading) setConfirmingQueue(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [confirmingQueue, libraryLoading]);
  return (
    <section className="tab-panel sources-tab">
      <div className="tab-heading">
        <div>
          <p className="overline">Always-on inputs</p>
          <h2>Source channels</h2>
          <p>
            ClipForge watches these channels, streams, and VODs for new moments.
          </p>
        </div>
        <span className="tab-count">
          {data.sourceChannels.length} / {data.tenant.sourceChannelLimit}
        </span>
      </div>
      <div className="sources-layout">
        <div className="source-roster">
          {data.sourceChannels.length ? (
            data.sourceChannels.map((source) => (
              <article key={source.id}>
                <span>
                  <Radio />
                </span>
                <div>
                  <b>{source.title}</b>
                  <p>
                    {source.platform === 'twitch' ? 'Twitch' : 'YouTube'} ·{' '}
                    {source.handle ||
                      source.platformLogin ||
                      source.platformUserId}
                  </p>
                  <small>Monitoring active</small>
                </div>
                <button
                  aria-label={`Remove ${source.title}`}
                  onClick={() => removeSource(source.id)}
                  disabled={saving}
                >
                  <Trash2 />
                </button>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <Radio />
              <b>No sources connected</b>
              <p>Add your first source to begin monitoring.</p>
            </div>
          )}
        </div>
        <aside className="source-connect-card">
          <span className="feature-icon">
            <Plus />
          </span>
          <h3>Add another source</h3>
          <p>
            YouTube channels, uploads, live replays, Twitch channels, and VOD
            links work.
          </p>
          <form className="channel-form" onSubmit={addSource}>
            <label htmlFor="source-channel">
              <Link2 /> Source URL or handle
            </label>
            <div>
              <input
                id="source-channel"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="youtube.com/@creator"
                required
              />
              <button
                aria-label="Connect source"
                disabled={
                  saving ||
                  !rightsConfirmed ||
                  data.sourceChannels.length >= data.tenant.sourceChannelLimit
                }
              >
                {saving ? <LoaderCircle className="spin" /> : <ArrowRight />}
              </button>
            </div>
            <label className="rights-check">
              <input
                type="checkbox"
                checked={rightsConfirmed}
                onChange={(event) => setRightsConfirmed(event.target.checked)}
              />
              <ShieldCheck /> I own or have permission to repurpose this source.
            </label>
          </form>
          {notice && <p className="form-notice">{notice}</p>}
        </aside>
      </div>
      <section className="past-library">
        <div className="past-library-head">
          <div>
            <span className="feature-icon purple">
              <Tv />
            </span>
            <div>
              <p className="overline">Manual backfill</p>
              <h3>Analyze and post from past videos</h3>
              <p>
                Every creator gets a fair spot: all latest uploads appear
                before any creator's second-latest video.
              </p>
            </div>
          </div>
        </div>
        <div className="past-library-controls">
          <div className="channel-picker-label">
            <b>Select source channels</b>
            <span>{librarySourceIds.length} selected</span>
          </div>
          <div
            className="channel-multi-picker"
            role="group"
            aria-label="Source channels for past videos"
          >
            {data.sourceChannels.map((source) => {
              const selected = librarySourceIds.includes(source.id);
              return (
                <button
                  type="button"
                  className={selected ? 'selected' : ''}
                  aria-pressed={selected}
                  onClick={() => toggleLibrarySource(source.id)}
                  key={source.id}
                >
                  <span>{selected ? <Check /> : <Plus />}</span>
                  <div>
                    <b>{source.title}</b>
                    <small>
                      {source.platform === 'twitch' ? 'Twitch' : 'YouTube'}
                    </small>
                  </div>
                </button>
              );
            })}
          </div>
          <button
            className="button button-dark"
            onClick={loadPastVideos}
            disabled={libraryLoading || !librarySourceIds.length}
          >
            {libraryLoading ? (
              <LoaderCircle className="spin" />
            ) : (
              <>
                <Eye /> Browse {librarySourceIds.length || ''} channel
                {librarySourceIds.length === 1 ? '' : 's'}
              </>
            )}
          </button>
        </div>
        {libraryNotice && <p className="library-notice">{libraryNotice}</p>}
        {pastVideos.length > 0 && (
          <>
            <div className="library-select-row">
              <button
                onClick={() =>
                  setSelectedKeys(
                    selectedKeys.length === selectableKeys.length
                      ? []
                      : selectableKeys,
                  )
                }
              >
                {selectedKeys.length === selectableKeys.length &&
                selectableKeys.length
                  ? 'Clear selection'
                  : `Select first ${selectableKeys.length}`}
              </button>
              <span>
                {selectedKeys.length} selected across {librarySourceIds.length}{' '}
                channel{librarySourceIds.length === 1 ? '' : 's'} · maximum 20
                per batch
              </span>
            </div>
            <div className="video-rounds">
              {videoRounds.map((round) => (
                <section
                  className="video-round"
                  aria-labelledby={`video-round-${round.rank}`}
                  key={round.rank}
                >
                  <div className="video-round-head">
                    <div>
                      <span>ROUND {round.rank + 1}</span>
                      <h4 id={`video-round-${round.rank}`}>
                        {round.rank === 0
                          ? 'Latest from every creator'
                          : round.rank === 1
                            ? 'Second-latest from every creator'
                            : round.rank === 2
                              ? 'Third-latest from every creator'
                              : `Previous uploads · round ${round.rank + 1}`}
                      </h4>
                    </div>
                    <small>
                      {round.videos.length} creator
                      {round.videos.length === 1 ? '' : 's'} represented
                    </small>
                  </div>
                  <div className="past-video-grid">
                    {round.videos.map((video) => {
                      const key = videoKey(video);
                      const selected = selectedKeys.includes(key);
                      return (
                        <label
                          className={`${video.alreadyQueued ? 'queued' : ''} ${selected ? 'selected' : ''}`}
                          key={key}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleVideo(video)}
                            disabled={video.alreadyQueued}
                          />
                          {video.thumbnailUrl ? (
                            <img
                              src={video.thumbnailUrl}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="video-placeholder">
                              <Play />
                            </span>
                          )}
                          <div>
                            <small>
                              {video.alreadyQueued
                                ? 'ALREADY QUEUED'
                                : `${video.sourceTitle} / ${video.platform.toUpperCase()}`}
                            </small>
                            <b>{video.title}</b>
                            <time>
                              {video.publishedAt
                                ? new Date(
                                    video.publishedAt,
                                  ).toLocaleDateString()
                                : 'Past upload'}
                            </time>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
            <div className="queue-selected-bar">
              <div>
                <b>
                  {selectedKeys.length} video
                  {selectedKeys.length === 1 ? '' : 's'} selected
                </b>
                <span>
                  ClipForge will analyze, caption, and publish this
                  cross-channel batch using your current autopilot settings.
                </span>
              </div>
              <button
                className="button button-primary"
                onClick={() => setConfirmingQueue(true)}
                disabled={libraryLoading || !selectedKeys.length}
              >
                {libraryLoading ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <>
                    <WandSparkles /> Analyze &amp; post selected
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </section>
      {confirmingQueue && (
        <div
          className="queue-confirm-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !libraryLoading)
              setConfirmingQueue(false);
          }}
        >
          <div
            className="queue-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="queue-confirm-title"
          >
            <span className="queue-confirm-check">
              <Check />
            </span>
            <p className="overline">Ready to launch</p>
            <h3 id="queue-confirm-title">Analyze and post this batch?</h3>
            <p>
              You selected <b>{selectedKeys.length} videos</b> from{' '}
              <b>
                {selectedSourceCount} creator
                {selectedSourceCount === 1 ? '' : 's'}
              </b>
              . ClipForge will use your current caption and publishing settings.
            </p>
            <div className="queue-confirm-actions">
              <button
                className="button button-ghost"
                onClick={() => setConfirmingQueue(false)}
                disabled={libraryLoading}
              >
                Go back
              </button>
              <button
                className="button button-primary"
                onClick={queueSelected}
                disabled={libraryLoading}
                autoFocus
              >
                {libraryLoading ? (
                  <>
                    <LoaderCircle className="spin" /> Queueing batch
                  </>
                ) : (
                  <>
                    <Check /> Confirm &amp; open jobs
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ProfilePanel({ data }: { data: DashboardData }) {
  return (
    <section className="profile-page">
      <div className="profile-intro">
        <span className="profile-orbit">
          <CircleUserRound />
        </span>
        <p className="overline">Your ClipForge identity</p>
        <h1>Profile and security</h1>
        <p>
          Manage your name, connected sign-in methods, password, active devices,
          and account security.
        </p>
        <div className="profile-facts">
          <span>
            <b>{data.tenant.plan}</b> plan
          </span>
          <span>
            <b>{data.channels[0]?.title || 'No destination'}</b> destination
          </span>
          <span>
            <b>{data.sourceChannels.length}</b> sources
          </span>
        </div>
      </div>
      <div className="profile-clerk">
        <UserProfile routing="hash" />
      </div>
    </section>
  );
}

function BillingPanel({
  data,
  saving,
  startCheckout,
}: {
  data: DashboardData;
  saving: boolean;
  startCheckout: (
    plan: 'creator' | 'clipping',
    billingCycle?: 'monthly' | 'annual',
  ) => void;
}) {
  return (
    <section className="billing-page">
      <div className="tab-heading">
        <div>
          <p className="overline">Plan and billing</p>
          <h2>Scale the publishing engine</h2>
          <p>
            Upgrade, review usage, update payment details, or cancel without
            contacting support.
          </p>
        </div>
        <span className="current-plan">
          <Sparkles /> {data.tenant.plan}
          {data.tenant.complimentaryCreator ? ' · lifetime complimentary' : ''}
        </span>
      </div>
      <div className="usage-strip">
        <article>
          <small>Monthly clips</small>
          <b>
            {data.tenant.clipsThisMonth} / {data.tenant.monthlyClipLimit}
          </b>
          <span>
            <i
              style={{
                width: `${Math.min(100, (data.tenant.clipsThisMonth / Math.max(1, data.tenant.monthlyClipLimit)) * 100)}%`,
              }}
            />
          </span>
        </article>
        <article>
          <small>Source channels</small>
          <b>
            {data.sourceChannels.length} / {data.tenant.sourceChannelLimit}
          </b>
          <span>
            <i
              style={{
                width: `${Math.min(100, (data.sourceChannels.length / Math.max(1, data.tenant.sourceChannelLimit)) * 100)}%`,
              }}
            />
          </span>
        </article>
      </div>
      <div className="upgrade-grid">
        <article>
          <span>CREATOR</span>
          <h3>
            $49<small>/month</small>
          </h3>
          <p>
            Five sources and 150 finished Shorts for your own content network.
          </p>
          <button
            className="button button-dark"
            onClick={() => startCheckout('creator')}
            disabled={
              saving ||
              data.tenant.complimentaryCreator ||
              data.tenant.plan !== 'free'
            }
          >
            {data.tenant.plan === 'creator' ? 'Current plan' : 'Choose Creator'}
          </button>
        </article>
        <article className="featured">
          <span>CLIPPING</span>
          <h3>
            $89<small>/month</small>
          </h3>
          <p>Fifteen sources for operators managing a full creator roster.</p>
          <button
            className="button button-primary"
            onClick={() => startCheckout('clipping')}
            disabled={
              saving ||
              data.tenant.complimentaryCreator ||
              ['clipping', 'studio'].includes(data.tenant.plan)
            }
          >
            {data.tenant.complimentaryCreator
              ? 'Lifetime access · $0'
              : data.tenant.plan === 'clipping'
                ? 'Current plan'
                : 'Upgrade to Clipping'}
          </button>
        </article>
      </div>
      <article className="cancel-card">
        <div>
          <span className="cancel-icon">
            <CreditCard />
          </span>
          <div>
            <h3>Billing controls stay in your hands</h3>
            <p>
              Open Whop’s self-service billing portal to update payment details,
              view invoices, or cancel your subscription immediately—no email or
              support ticket required.
            </p>
          </div>
        </div>
        <a
          className="button button-ghost"
          href="https://whop.com/@me/settings/orders/"
          target="_blank"
          rel="noreferrer"
        >
          Manage or cancel subscription <ExternalLink />
        </a>
      </article>
    </section>
  );
}

function SettingsPanel({
  initial,
  onSaved,
}: {
  initial: CreatorPreferences;
  onSaved: (dashboard: DashboardData) => void;
}) {
  const [preferences, setPreferences] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const update = <K extends keyof CreatorPreferences>(
    key: K,
    value: CreatorPreferences[K],
  ) => setPreferences((current) => ({ ...current, [key]: value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice('');
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(preferences),
    });
    const body = await response.json();
    setSaving(false);
    setNotice(
      response.ok
        ? 'Autopilot settings saved. New jobs will use them.'
        : body.error || 'Settings could not be saved.',
    );
    if (body.dashboard) onSaved(body.dashboard);
  }

  return (
    <section className="control-center" id="settings">
      <div className="analytics-heading">
        <div>
          <p className="overline">Control without babysitting</p>
          <h2>Autopilot control center</h2>
          <p>
            Choose how ClipForge selects, styles, and publishes every new batch.
          </p>
        </div>
        <span className="learning-chip">
          <WandSparkles /> Performance learning{' '}
          {preferences.learningEnabled ? 'on' : 'off'}
        </span>
      </div>
      <form onSubmit={save}>
        <div className="control-grid">
          <fieldset>
            <legend>
              <Rocket /> Publishing mode
            </legend>
            <div className="choice-cards">
              <button
                type="button"
                className={
                  preferences.publishMode === 'automatic' ? 'selected' : ''
                }
                onClick={() => update('publishMode', 'automatic')}
              >
                <b>Automatic</b>
                <span>Best clips go public without another click.</span>
              </button>
              <button
                type="button"
                className={
                  preferences.publishMode === 'review' ? 'selected' : ''
                }
                onClick={() => update('publishMode', 'review')}
              >
                <b>Review first</b>
                <span>Upload privately, then publish from ClipForge.</span>
              </button>
            </div>
          </fieldset>
          <fieldset>
            <legend>
              <SlidersHorizontal /> Clip recipe
            </legend>
            <div className="field-row">
              <label>
                Clips per video
                <select
                  value={preferences.clipsPerVideo}
                  onChange={(event) =>
                    update('clipsPerVideo', Number(event.target.value))
                  }
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Minimum
                <select
                  value={preferences.minClipSeconds}
                  onChange={(event) =>
                    update('minClipSeconds', Number(event.target.value))
                  }
                >
                  {[10, 15, 20, 25, 30]
                    .filter((value) => value < preferences.maxClipSeconds)
                    .map((value) => (
                      <option key={value} value={value}>
                        {value}s
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Maximum
                <select
                  value={preferences.maxClipSeconds}
                  onChange={(event) =>
                    update('maxClipSeconds', Number(event.target.value))
                  }
                >
                  {[20, 25, 32, 40, 50, 60]
                    .filter((value) => value > preferences.minClipSeconds)
                    .map((value) => (
                      <option key={value} value={value}>
                        {value}s
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend>
              <Captions /> Caption preset
            </legend>
            <div className="preset-row">
              {(['impact', 'clean', 'minimal'] as const).map((style) => (
                <button
                  type="button"
                  key={style}
                  className={`caption-preset ${style} ${preferences.captionStyle === style ? 'selected' : ''}`}
                  onClick={() => update('captionStyle', style)}
                >
                  <span>MAKE IT COUNT</span>
                  <b>{style}</b>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>
              <Palette /> Brand and metadata
            </legend>
            <div className="brand-fields">
              <label>
                Highlight color
                <input
                  type="color"
                  value={preferences.brandColor}
                  onChange={(event) =>
                    update('brandColor', event.target.value.toUpperCase())
                  }
                />
              </label>
              <label>
                Default hashtags
                <input
                  type="text"
                  value={preferences.hashtags}
                  onChange={(event) => update('hashtags', event.target.value)}
                  placeholder="#Shorts #Minecraft"
                />
              </label>
            </div>
          </fieldset>
        </div>
        <label className="learning-toggle">
          <input
            type="checkbox"
            checked={preferences.learningEnabled}
            onChange={(event) =>
              update('learningEnabled', event.target.checked)
            }
          />
          <span>
            <TrendingUp />
            <b>Learn from winning Shorts</b>
            <small>
              Feed recent views, average watch time, and engagement back into
              future moment selection.
            </small>
          </span>
        </label>
        <div className="control-actions">
          {notice && <p className="form-notice">{notice}</p>}
          <button className="button button-dark" disabled={saving}>
            {saving ? (
              <LoaderCircle className="spin" />
            ) : (
              <>
                <Check /> Save autopilot
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

function compactNumber(value: number) {
  return Intl.NumberFormat('en', {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

function durationLabel(seconds: number) {
  const rounded = Math.round(seconds);
  return rounded < 60
    ? `${rounded}s`
    : `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}

function AnalyticsPanel({ destinationId }: { destinationId: string }) {
  const [range, setRange] = useState<7 | 28 | 90>(28);
  const [analytics, setAnalytics] = useState<ChannelAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/analytics?range=${range}${refresh ? '&refresh=1' : ''}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error || 'Analytics could not be loaded');
        return body as ChannelAnalytics;
      })
      .then((body) => setAnalytics(body))
      .catch((reason) => {
        if (reason.name !== 'AbortError') setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [destinationId, range, refresh]);

  const peakViews = Math.max(
    1,
    ...(analytics?.trend.map((day) => day.views) || [1]),
  );
  const bestShort = analytics?.shorts[0];

  return (
    <section className="analytics-panel" id="analytics">
      <div className="analytics-heading">
        <div>
          <p className="overline">YouTube performance</p>
          <h2>Channel analytics</h2>
          <p>
            See what grows the destination channel, then reuse the winning
            patterns.
          </p>
        </div>
        <div className="analytics-controls">
          <div className="range-tabs">
            {([7, 28, 90] as const).map((days) => (
              <button
                className={range === days ? 'active' : ''}
                key={days}
                onClick={() => setRange(days)}
              >
                {days}D
              </button>
            ))}
          </div>
          <button
            className="refresh-button"
            aria-label="Refresh analytics"
            title="Refresh from YouTube"
            onClick={() => setRefresh((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !analytics ? (
        <div className="analytics-loading">
          <LoaderCircle className="spin" />
          <b>Syncing YouTube Analytics…</b>
          <p>
            Views, watch time, engagement, and subscriber growth are loading.
          </p>
        </div>
      ) : error ? (
        <div className="analytics-error">
          <BarChart3 />
          <div>
            <b>Analytics need attention</b>
            <p>{error}</p>
          </div>
          <a className="button button-dark" href="/api/auth/youtube/start">
            Reconnect YouTube
          </a>
        </div>
      ) : (
        analytics && (
          <>
            <div className="channel-total-row">
              <span>
                <Users />{' '}
                <b>
                  {analytics.channelTotals.subscribers === null
                    ? 'Hidden'
                    : compactNumber(analytics.channelTotals.subscribers)}
                </b>{' '}
                subscribers
              </span>
              <span>
                <Eye />{' '}
                <b>{compactNumber(analytics.channelTotals.lifetimeViews)}</b>{' '}
                lifetime views
              </span>
              <span>
                <Captions />{' '}
                <b>{compactNumber(analytics.channelTotals.videos)}</b> public
                videos
              </span>
              <small>
                Updated{' '}
                {new Date(analytics.syncedAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}{' '}
                · through{' '}
                {new Date(`${analytics.endDate}T12:00:00`).toLocaleDateString(
                  [],
                  { month: 'short', day: 'numeric' },
                )}
              </small>
            </div>

            <div className="analytics-kpis">
              <article>
                <span className="metric-icon green">
                  <Eye />
                </span>
                <div>
                  <small>Views</small>
                  <b>{compactNumber(analytics.summary.views)}</b>
                  <p>last {range} days</p>
                </div>
              </article>
              <article>
                <span className="metric-icon purple">
                  <Timer />
                </span>
                <div>
                  <small>Watch time</small>
                  <b>
                    {compactNumber(
                      Math.round(analytics.summary.watchMinutes / 60),
                    )}
                    h
                  </b>
                  <p>
                    {durationLabel(analytics.summary.averageViewDuration)}{' '}
                    average view
                  </p>
                </div>
              </article>
              <article>
                <span className="metric-icon orange">
                  <Users />
                </span>
                <div>
                  <small>Net subscribers</small>
                  <b>
                    {analytics.summary.netSubscribers > 0 ? '+' : ''}
                    {compactNumber(analytics.summary.netSubscribers)}
                  </b>
                  <p>
                    {analytics.summary.subscribersGained} gained ·{' '}
                    {analytics.summary.subscribersLost} lost
                  </p>
                </div>
              </article>
              <article>
                <span className="metric-icon red">
                  <ThumbsUp />
                </span>
                <div>
                  <small>Engagement</small>
                  <b>{analytics.summary.engagementRate}%</b>
                  <p>
                    {compactNumber(analytics.summary.likes)} likes ·{' '}
                    {compactNumber(analytics.summary.comments)} comments
                  </p>
                </div>
              </article>
            </div>

            <div className="analytics-layout">
              <article className="analytics-card trend-card">
                <div className="analytics-card-title">
                  <div>
                    <small>DAILY VIEWS</small>
                    <h3>{compactNumber(analytics.summary.views)} total</h3>
                  </div>
                  <TrendingUp />
                </div>
                <div
                  className="views-chart"
                  aria-label={`Daily views over ${range} days`}
                >
                  {analytics.trend.map((day) => (
                    <i
                      key={day.date}
                      title={`${new Date(`${day.date}T12:00:00`).toLocaleDateString()}: ${day.views.toLocaleString()} views`}
                      style={{
                        height: `${Math.max(3, (day.views / peakViews) * 100)}%`,
                      }}
                    />
                  ))}
                </div>
                <div className="chart-axis">
                  <span>
                    {new Date(
                      `${analytics.startDate}T12:00:00`,
                    ).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <span>
                    {new Date(
                      `${analytics.endDate}T12:00:00`,
                    ).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              </article>
              <article className="analytics-card insight-card">
                <small>WHAT’S WORKING</small>
                {bestShort ? (
                  <>
                    <h3>{bestShort.title}</h3>
                    <p>
                      Your leading ClipForge Short generated{' '}
                      <b>{compactNumber(bestShort.views)} views</b>,{' '}
                      {compactNumber(bestShort.likes)} likes, and{' '}
                      {bestShort.subscribersGained} subscribers in this period.
                    </p>
                    <a href={bestShort.url} target="_blank">
                      Watch top Short <ExternalLink />
                    </a>
                  </>
                ) : (
                  <>
                    <h3>Performance signals are collecting</h3>
                    <p>
                      Once ClipForge-published Shorts receive views, their
                      retention and engagement will appear here for comparison.
                    </p>
                  </>
                )}
              </article>
            </div>

            <article className="short-performance">
              <div className="analytics-card-title">
                <div>
                  <small>CLIPFORGE OUTPUT</small>
                  <h3>Short performance</h3>
                </div>
                <span>{analytics.shorts.length} tracked</span>
              </div>
              {analytics.shorts.length ? (
                <div className="short-table">
                  <div className="short-table-head">
                    <span>Short</span>
                    <span>Views</span>
                    <span>Avg view</span>
                    <span>Likes</span>
                    <span>Comments</span>
                    <span>Subs</span>
                  </div>
                  {analytics.shorts.map((short, index) => (
                    <a
                      href={short.url}
                      target="_blank"
                      key={short.videoId}
                      className="short-table-row"
                    >
                      <span>
                        <b>#{index + 1}</b>
                        <em>{short.title}</em>
                      </span>
                      <span>{compactNumber(short.views)}</span>
                      <span>{durationLabel(short.averageViewDuration)}</span>
                      <span>
                        <ThumbsUp /> {compactNumber(short.likes)}
                      </span>
                      <span>
                        <MessageCircle /> {compactNumber(short.comments)}
                      </span>
                      <span>
                        {short.subscribersGained
                          ? `+${short.subscribersGained}`
                          : '—'}
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="analytics-empty">
                  <BarChart3 />
                  <b>No ClipForge Short data in this period yet</b>
                  <p>
                    Channel-level views still appear above. Per-Short results
                    populate after uploads receive traffic.
                  </p>
                </div>
              )}
            </article>
          </>
        )
      )}
    </section>
  );
}

function EmptyOnboarding({ name }: { name: string }) {
  return (
    <section className="onboarding-empty">
      <div className="onboarding-orbit">
        <span>
          <UploadCloud />
        </span>
      </div>
      <p className="overline">Welcome, {name.split(' ')[0]}</p>
      <h1>Let’s publish your first Shorts.</h1>
      <p>
        This is a brand-new workspace with nothing linked. Sign in with Google
        below and choose the YouTube channel where ClipForge should upload your
        finished clips.
      </p>
      <a
        className="button button-primary button-large"
        href="/api/auth/youtube/start"
      >
        Connect YouTube with Google <ArrowRight />
      </a>
      <small>
        <Check /> A channel is linked only after Google confirms you own it
      </small>
    </section>
  );
}

function SourceOnboarding({
  destination,
  sourceUrl,
  setSourceUrl,
  rightsConfirmed,
  setRightsConfirmed,
  addSource,
  saving,
  notice,
}: {
  destination: string;
  sourceUrl: string;
  setSourceUrl: (value: string) => void;
  rightsConfirmed: boolean;
  setRightsConfirmed: (value: boolean) => void;
  addSource: (event: React.FormEvent) => void;
  saving: boolean;
  notice: string;
}) {
  return (
    <section className="onboarding-empty source-onboarding" id="channels">
      <div className="onboarding-orbit connected">
        <span>
          <Check />
        </span>
      </div>
      <p className="overline">Destination connected</p>
      <h1>Now choose where clips come from.</h1>
      <p>
        Finished Shorts will post to <b>{destination}</b>. Add YouTube channels
        or Twitch creators for ClipForge to monitor.
      </p>
      <form className="onboarding-form source-first-form" onSubmit={addSource}>
        <div>
          <input
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="youtube.com/@creator or twitch.tv/creator"
            required
          />
          <button
            className="button button-primary"
            disabled={saving || !rightsConfirmed}
          >
            {saving ? (
              <LoaderCircle className="spin" />
            ) : (
              <>
                Connect source <ArrowRight />
              </>
            )}
          </button>
        </div>
        <label className="rights-check">
          <input
            type="checkbox"
            checked={rightsConfirmed}
            onChange={(event) => setRightsConfirmed(event.target.checked)}
          />
          <ShieldCheck /> I own or have permission to repurpose this source.
        </label>
      </form>
      {notice && <p className="form-notice">{notice}</p>}
      <small>
        YouTube uploads and stream replays plus Twitch VODs are supported.
      </small>
    </section>
  );
}
