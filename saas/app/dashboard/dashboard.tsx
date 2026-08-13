'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { Activity, ArrowRight, BarChart3, Captions, Check, Clock3, ExternalLink, Eye, Gauge, LayoutDashboard, Link2, LoaderCircle, MessageCircle, Play, Plus, Radio, RefreshCw, Settings, Sparkles, ThumbsUp, Timer, Trash2, TrendingUp, Tv, UploadCloud, Users } from 'lucide-react';
import type { ChannelAnalytics, DashboardData, JobStatus } from '@/lib/types';

const statusLabels: Record<JobStatus, string> = { queued: 'Queued', downloading: 'Downloading', transcribing: 'Transcribing', selecting: 'Selecting moments', rendering: 'Rendering clips', uploading: 'Publishing', complete: 'Published', failed: 'Needs attention' };
const stageOrder: JobStatus[] = ['downloading', 'transcribing', 'selecting', 'rendering', 'uploading', 'complete'];

function relative(value: string) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

export default function Dashboard({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial);
  const [sourceUrl, setSourceUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const destination = data.channels[0];
  const active = data.jobs.find((job) => !['complete', 'failed'].includes(job.status));
  const completedClips = data.jobs.flatMap((job) => job.clips).filter((clip) => clip.status === 'uploaded');
  const deadlineRemaining = active ? Math.max(0, new Date(active.deadlineAt).getTime() - Date.now()) : 0;
  const remainingLabel = useMemo(() => `${String(Math.floor(deadlineRemaining / 3600000)).padStart(2, '0')}:${String(Math.floor(deadlineRemaining % 3600000 / 60000)).padStart(2, '0')}`, [deadlineRemaining]);

  async function addSource(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setNotice('');
    const response = await fetch('/api/channels', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: sourceUrl }) });
    const body = await response.json(); setSaving(false);
    setNotice(response.ok ? body.message || 'Source connected. New uploads are now monitored.' : body.error || 'Could not connect source.');
    if (body.dashboard) { setData(body.dashboard); setSourceUrl(''); }
  }

  async function removeSource(id: string) {
    setSaving(true); setNotice('');
    const response = await fetch('/api/channels', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    const body = await response.json(); setSaving(false);
    if (body.dashboard) setData(body.dashboard);
    if (!response.ok) setNotice(body.error || 'Could not remove source.');
  }

  async function startCheckout(billingCycle: 'monthly' | 'annual' = 'monthly') {
    setSaving(true);
    const response = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'creator', billingCycle }) });
    const body = await response.json(); setSaving(false);
    if (body.url) window.location.href = body.url;
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/"><span className="brand-mark"><Play size={15} fill="currentColor" /></span>ClipForge <em>Cloud</em></Link>
      <nav className="side-nav"><a className="active" href="#overview"><LayoutDashboard /> Overview</a>{destination && <><a href="#analytics"><BarChart3 /> Analytics</a><a href="#jobs"><Activity /> Jobs <span>{data.jobs.length}</span></a><a href="#clips"><Captions /> Clips</a><a href="#channels"><Tv /> Sources <span>{data.sourceChannels.length}</span></a></>}</nav>
      <div className="side-bottom"><a href="#settings"><Settings /> Settings</a><div className="account-chip"><UserButton /><div><b>{data.tenant.name}</b><small>{data.tenant.email}</small></div></div></div>
    </aside>

    <section className="app-main" id="overview">
      {!destination ? <EmptyOnboarding name={data.tenant.name} /> : <>
        <header className="app-header"><div><p className="overline">Creator workspace</p><h1>{destination.title}</h1><p>Shorts publish here. Your {data.tenant.plan} plan supports {data.tenant.sourceChannelLimit} source channel{data.tenant.sourceChannelLimit === 1 ? '' : 's'}.</p></div><div className="header-actions"><span className="live-chip"><i /> Destination connected</span><button className="button button-dark" onClick={() => document.querySelector('#channels')?.scrollIntoView()}><Plus size={17} /> Add source</button></div></header>

        {!data.sourceChannels.length ? <SourceOnboarding destination={destination.title} sourceUrl={sourceUrl} setSourceUrl={setSourceUrl} addSource={addSource} saving={saving} notice={notice} /> : <>
          <div className="metrics-grid">
            <article><div><span className="metric-icon green"><Gauge /></span><small>SLA delivery</small></div><b>{data.sla.deliveredOnTimePercent}%</b><p>within 3 hours</p></article>
            <article><div><span className="metric-icon purple"><Captions /></span><small>Clips this month</small></div><b>{data.tenant.clipsThisMonth}</b><p>of {data.tenant.monthlyClipLimit} included</p></article>
            <article><div><span className="metric-icon orange"><Clock3 /></span><small>Average turnaround</small></div><b>{data.sla.averageMinutes || '—'}{data.sla.averageMinutes ? 'm' : ''}</b><p>from detection to live</p></article>
            <article><div><span className="metric-icon red"><Radio /></span><small>Source channels</small></div><b>{data.sourceChannels.length}</b><p>actively monitored</p></article>
          </div>

          {active && <article className="active-job" id="jobs"><div className="active-top"><div><span className="status-badge"><LoaderCircle className="spin" /> Processing now</span><h2>{active.sourceTitle}</h2><p>Detected {relative(active.detectedAt)} · {statusLabels[active.status]}</p></div><div className="deadline"><small>Time remaining</small><b>{remainingLabel}</b><span>{data.sla.targetMinutes === 180 ? 'Creator priority · 3-hour target' : 'Standard queue'}</span></div></div><div className="progress-track"><i style={{ width: `${active.progress}%` }} /></div><div className="stages">{stageOrder.map((stage, index) => { const current = stageOrder.indexOf(active.status); const done = current > index || active.status === 'complete'; return <div className={done ? 'done' : current === index ? 'current' : ''} key={stage}><span>{done ? <Check /> : index + 1}</span><b>{statusLabels[stage]}</b></div>; })}</div></article>}

          <div className="dashboard-columns">
            <section className="panel" id="clips"><div className="panel-header"><div><p className="overline">Recent output</p><h2>Published clips</h2></div></div><div className="clip-list">{completedClips.length ? completedClips.map((clip) => <a className="clip-row" href={clip.youtubeUrl || '#'} target="_blank" key={clip.id}><div className="clip-thumb"><Play fill="currentColor" /></div><div><b>{clip.title}</b><p>{clip.durationSeconds}s · YouTube Short</p></div><span className="published-dot">Live</span><ExternalLink /></a>) : <div className="empty-state"><UploadCloud /><b>Your first clips will appear here</b><p>We are watching your source channels for new uploads.</p></div>}</div></section>

            <section className="panel setup-panel" id="channels"><div className="panel-header"><div><p className="overline">Input channels</p><h2>Clip sources</h2></div><span className="step-count">{data.sourceChannels.length} active</span></div>
              <div className="source-list">{data.sourceChannels.map((source) => <div className="source-item" key={source.id}><span><Radio /></span><div><b>{source.title}</b><p>{source.platform === 'twitch' ? 'Twitch' : 'YouTube'} · {source.handle || source.platformLogin || source.platformUserId}</p></div><button aria-label={`Remove ${source.title}`} onClick={() => removeSource(source.id)} disabled={saving}><Trash2 /></button></div>)}</div>
              <form className="channel-form" onSubmit={addSource}><label htmlFor="channel"><Link2 /> Add a YouTube or Twitch source</label><div><input id="channel" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="youtube.com/@creator or twitch.tv/creator" required /><button disabled={saving || data.sourceChannels.length >= data.tenant.sourceChannelLimit}>{saving ? <LoaderCircle className="spin" /> : <Plus />}</button></div><small>Channel, stream, and VOD links work. Replays are clipped automatically after streams end.</small></form>{notice && <p className="form-notice">{notice}</p>}
            </section>
          </div>
        </>}

        <AnalyticsPanel destinationId={destination.id} />

        <section className="billing-banner" id="billing"><div><span className="feature-icon purple"><Sparkles /></span><div><p className="overline">{data.tenant.plan} plan{data.tenant.complimentaryCreator ? ' · lifetime' : ''}</p><h2>{data.tenant.clipsThisMonth} / {data.tenant.monthlyClipLimit} uploads this month</h2><p>{data.sourceChannels.length} / {data.tenant.sourceChannelLimit} source channels connected.</p></div></div><div className="billing-actions"><a className="button button-ghost" href="/api/auth/youtube/start">Change destination</a>{!data.tenant.complimentaryCreator && <><button className="button button-ghost" onClick={() => startCheckout('monthly')} disabled={saving}>$49 monthly</button><button className="button button-primary" onClick={() => startCheckout('annual')} disabled={saving}>$520 yearly · Save $68 <ArrowRight /></button></>}</div></section>
      </>}
    </section>
  </main>;
}

function compactNumber(value: number) {
  return Intl.NumberFormat('en', { notation: value >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

function durationLabel(seconds: number) {
  const rounded = Math.round(seconds);
  return rounded < 60 ? `${rounded}s` : `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}

function AnalyticsPanel({ destinationId }: { destinationId: string }) {
  const [range, setRange] = useState<7 | 28 | 90>(28);
  const [analytics, setAnalytics] = useState<ChannelAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`/api/analytics?range=${range}${refresh ? '&refresh=1' : ''}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Analytics could not be loaded');
        return body as ChannelAnalytics;
      })
      .then((body) => setAnalytics(body))
      .catch((reason) => { if (reason.name !== 'AbortError') setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [destinationId, range, refresh]);

  const peakViews = Math.max(1, ...(analytics?.trend.map((day) => day.views) || [1]));
  const bestShort = analytics?.shorts[0];

  return <section className="analytics-panel" id="analytics">
    <div className="analytics-heading">
      <div><p className="overline">YouTube performance</p><h2>Channel analytics</h2><p>See what grows the destination channel, then reuse the winning patterns.</p></div>
      <div className="analytics-controls">
        <div className="range-tabs">{([7, 28, 90] as const).map((days) => <button className={range === days ? 'active' : ''} key={days} onClick={() => setRange(days)}>{days}D</button>)}</div>
        <button className="refresh-button" aria-label="Refresh analytics" title="Refresh from YouTube" onClick={() => setRefresh((value) => value + 1)} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} /></button>
      </div>
    </div>

    {loading && !analytics ? <div className="analytics-loading"><LoaderCircle className="spin" /><b>Syncing YouTube Analytics…</b><p>Views, watch time, engagement, and subscriber growth are loading.</p></div> : error ? <div className="analytics-error"><BarChart3 /><div><b>Analytics need attention</b><p>{error}</p></div><a className="button button-dark" href="/api/auth/youtube/start">Reconnect YouTube</a></div> : analytics && <>
      <div className="channel-total-row">
        <span><Users /> <b>{analytics.channelTotals.subscribers === null ? 'Hidden' : compactNumber(analytics.channelTotals.subscribers)}</b> subscribers</span>
        <span><Eye /> <b>{compactNumber(analytics.channelTotals.lifetimeViews)}</b> lifetime views</span>
        <span><Captions /> <b>{compactNumber(analytics.channelTotals.videos)}</b> public videos</span>
        <small>Updated {new Date(analytics.syncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · through {new Date(`${analytics.endDate}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}</small>
      </div>

      <div className="analytics-kpis">
        <article><span className="metric-icon green"><Eye /></span><div><small>Views</small><b>{compactNumber(analytics.summary.views)}</b><p>last {range} days</p></div></article>
        <article><span className="metric-icon purple"><Timer /></span><div><small>Watch time</small><b>{compactNumber(Math.round(analytics.summary.watchMinutes / 60))}h</b><p>{durationLabel(analytics.summary.averageViewDuration)} average view</p></div></article>
        <article><span className="metric-icon orange"><Users /></span><div><small>Net subscribers</small><b>{analytics.summary.netSubscribers > 0 ? '+' : ''}{compactNumber(analytics.summary.netSubscribers)}</b><p>{analytics.summary.subscribersGained} gained · {analytics.summary.subscribersLost} lost</p></div></article>
        <article><span className="metric-icon red"><ThumbsUp /></span><div><small>Engagement</small><b>{analytics.summary.engagementRate}%</b><p>{compactNumber(analytics.summary.likes)} likes · {compactNumber(analytics.summary.comments)} comments</p></div></article>
      </div>

      <div className="analytics-layout">
        <article className="analytics-card trend-card">
          <div className="analytics-card-title"><div><small>DAILY VIEWS</small><h3>{compactNumber(analytics.summary.views)} total</h3></div><TrendingUp /></div>
          <div className="views-chart" aria-label={`Daily views over ${range} days`}>{analytics.trend.map((day) => <i key={day.date} title={`${new Date(`${day.date}T12:00:00`).toLocaleDateString()}: ${day.views.toLocaleString()} views`} style={{ height: `${Math.max(3, day.views / peakViews * 100)}%` }} />)}</div>
          <div className="chart-axis"><span>{new Date(`${analytics.startDate}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span><span>{new Date(`${analytics.endDate}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></div>
        </article>
        <article className="analytics-card insight-card">
          <small>WHAT’S WORKING</small>
          {bestShort ? <><h3>{bestShort.title}</h3><p>Your leading ClipForge Short generated <b>{compactNumber(bestShort.views)} views</b>, {compactNumber(bestShort.likes)} likes, and {bestShort.subscribersGained} subscribers in this period.</p><a href={bestShort.url} target="_blank">Watch top Short <ExternalLink /></a></> : <><h3>Performance signals are collecting</h3><p>Once ClipForge-published Shorts receive views, their retention and engagement will appear here for comparison.</p></>}
        </article>
      </div>

      <article className="short-performance">
        <div className="analytics-card-title"><div><small>CLIPFORGE OUTPUT</small><h3>Short performance</h3></div><span>{analytics.shorts.length} tracked</span></div>
        {analytics.shorts.length ? <div className="short-table">
          <div className="short-table-head"><span>Short</span><span>Views</span><span>Avg view</span><span>Likes</span><span>Comments</span><span>Subs</span></div>
          {analytics.shorts.map((short, index) => <a href={short.url} target="_blank" key={short.videoId} className="short-table-row"><span><b>#{index + 1}</b><em>{short.title}</em></span><span>{compactNumber(short.views)}</span><span>{durationLabel(short.averageViewDuration)}</span><span><ThumbsUp /> {compactNumber(short.likes)}</span><span><MessageCircle /> {compactNumber(short.comments)}</span><span>{short.subscribersGained ? `+${short.subscribersGained}` : '—'}</span></a>)}
        </div> : <div className="analytics-empty"><BarChart3 /><b>No ClipForge Short data in this period yet</b><p>Channel-level views still appear above. Per-Short results populate after uploads receive traffic.</p></div>}
      </article>
    </>}
  </section>;
}

function EmptyOnboarding({ name }: { name: string }) {
  return <section className="onboarding-empty"><div className="onboarding-orbit"><span><UploadCloud /></span></div><p className="overline">Welcome, {name.split(' ')[0]}</p><h1>Let’s publish your first Shorts.</h1><p>Your dashboard is empty because no destination channel is connected yet. Choose the YouTube channel where ClipForge should upload your finished clips.</p><a className="button button-primary button-large" href="/api/auth/youtube/start">Get started <ArrowRight /></a><small><Check /> You will approve YouTube upload access on Google</small></section>;
}

function SourceOnboarding({ destination, sourceUrl, setSourceUrl, addSource, saving, notice }: { destination: string; sourceUrl: string; setSourceUrl: (value: string) => void; addSource: (event: React.FormEvent) => void; saving: boolean; notice: string }) {
  return <section className="onboarding-empty source-onboarding" id="channels"><div className="onboarding-orbit connected"><span><Check /></span></div><p className="overline">Destination connected</p><h1>Now choose where clips come from.</h1><p>Finished Shorts will post to <b>{destination}</b>. Add YouTube channels or Twitch creators for ClipForge to monitor.</p><form className="onboarding-form" onSubmit={addSource}><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="youtube.com/@creator or twitch.tv/creator" required /><button className="button button-primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <>Connect source <ArrowRight /></>}</button></form>{notice && <p className="form-notice">{notice}</p>}<small>YouTube uploads and stream replays plus Twitch VODs are supported.</small></section>;
}
