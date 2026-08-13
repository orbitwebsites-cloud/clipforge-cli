'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { Activity, ArrowRight, Captions, Check, Clock3, ExternalLink, Gauge, LayoutDashboard, Link2, LoaderCircle, Play, Plus, Radio, Settings, Sparkles, Trash2, Tv, UploadCloud } from 'lucide-react';
import type { DashboardData, JobStatus } from '@/lib/types';

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
    setNotice(response.ok ? 'Source connected. New uploads are now monitored.' : body.error || 'Could not connect source.');
    if (body.dashboard) { setData(body.dashboard); setSourceUrl(''); }
  }

  async function removeSource(id: string) {
    setSaving(true); setNotice('');
    const response = await fetch('/api/channels', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    const body = await response.json(); setSaving(false);
    if (body.dashboard) setData(body.dashboard);
    if (!response.ok) setNotice(body.error || 'Could not remove source.');
  }

  async function startCheckout() {
    setSaving(true);
    const response = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'creator' }) });
    const body = await response.json(); setSaving(false);
    if (body.url) window.location.href = body.url;
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/"><span className="brand-mark"><Play size={15} fill="currentColor" /></span>ClipForge <em>Cloud</em></Link>
      <nav className="side-nav"><a className="active" href="#overview"><LayoutDashboard /> Overview</a>{destination && <><a href="#jobs"><Activity /> Jobs <span>{data.jobs.length}</span></a><a href="#clips"><Captions /> Clips</a><a href="#channels"><Tv /> Sources <span>{data.sourceChannels.length}</span></a></>}</nav>
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

          {active && <article className="active-job" id="jobs"><div className="active-top"><div><span className="status-badge"><LoaderCircle className="spin" /> Processing now</span><h2>{active.sourceTitle}</h2><p>Detected {relative(active.detectedAt)} · {statusLabels[active.status]}</p></div><div className="deadline"><small>Time remaining</small><b>{remainingLabel}</b><span>3-hour target</span></div></div><div className="progress-track"><i style={{ width: `${active.progress}%` }} /></div><div className="stages">{stageOrder.map((stage, index) => { const current = stageOrder.indexOf(active.status); const done = current > index || active.status === 'complete'; return <div className={done ? 'done' : current === index ? 'current' : ''} key={stage}><span>{done ? <Check /> : index + 1}</span><b>{statusLabels[stage]}</b></div>; })}</div></article>}

          <div className="dashboard-columns">
            <section className="panel" id="clips"><div className="panel-header"><div><p className="overline">Recent output</p><h2>Published clips</h2></div></div><div className="clip-list">{completedClips.length ? completedClips.map((clip) => <a className="clip-row" href={clip.youtubeUrl || '#'} target="_blank" key={clip.id}><div className="clip-thumb"><Play fill="currentColor" /></div><div><b>{clip.title}</b><p>{clip.durationSeconds}s · YouTube Short</p></div><span className="published-dot">Live</span><ExternalLink /></a>) : <div className="empty-state"><UploadCloud /><b>Your first clips will appear here</b><p>We are watching your source channels for new uploads.</p></div>}</div></section>

            <section className="panel setup-panel" id="channels"><div className="panel-header"><div><p className="overline">Input channels</p><h2>Clip sources</h2></div><span className="step-count">{data.sourceChannels.length} active</span></div>
              <div className="source-list">{data.sourceChannels.map((source) => <div className="source-item" key={source.id}><span><Radio /></span><div><b>{source.title}</b><p>{source.handle || source.youtubeChannelId}</p></div><button aria-label={`Remove ${source.title}`} onClick={() => removeSource(source.id)} disabled={saving}><Trash2 /></button></div>)}</div>
              <form className="channel-form" onSubmit={addSource}><label htmlFor="channel"><Link2 /> Add another source channel</label><div><input id="channel" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://youtube.com/@creator" required /><button disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Plus />}</button></div><small>Public uploads and completed livestream replays are monitored.</small></form>{notice && <p className="form-notice">{notice}</p>}
            </section>
          </div>
        </>}

        <section className="billing-banner" id="billing"><div><span className="feature-icon purple"><Sparkles /></span><div><p className="overline">{data.tenant.plan} plan{data.tenant.complimentaryCreator ? ' · lifetime' : ''}</p><h2>{data.tenant.clipsThisMonth} / {data.tenant.monthlyClipLimit} uploads this month</h2><p>{data.sourceChannels.length} / {data.tenant.sourceChannelLimit} source channels connected.</p></div></div><div className="billing-actions"><a className="button button-ghost" href="/api/auth/youtube/start">Change destination</a>{!data.tenant.complimentaryCreator && <button className="button button-primary" onClick={startCheckout} disabled={saving}>{data.tenant.plan === 'free' ? 'Upgrade to Creator' : 'Manage subscription'} <ArrowRight /></button>}</div></section>
      </>}
    </section>
  </main>;
}

function EmptyOnboarding({ name }: { name: string }) {
  return <section className="onboarding-empty"><div className="onboarding-orbit"><span><UploadCloud /></span></div><p className="overline">Welcome, {name.split(' ')[0]}</p><h1>Let’s publish your first Shorts.</h1><p>Your dashboard is empty because no destination channel is connected yet. Choose the YouTube channel where ClipForge should upload your finished clips.</p><a className="button button-primary button-large" href="/api/auth/youtube/start">Get started <ArrowRight /></a><small><Check /> You will approve YouTube upload access on Google</small></section>;
}

function SourceOnboarding({ destination, sourceUrl, setSourceUrl, addSource, saving, notice }: { destination: string; sourceUrl: string; setSourceUrl: (value: string) => void; addSource: (event: React.FormEvent) => void; saving: boolean; notice: string }) {
  return <section className="onboarding-empty source-onboarding" id="channels"><div className="onboarding-orbit connected"><span><Check /></span></div><p className="overline">Destination connected</p><h1>Now choose where clips come from.</h1><p>Finished Shorts will post to <b>{destination}</b>. Add one or more public YouTube channels for ClipForge to monitor.</p><form className="onboarding-form" onSubmit={addSource}><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://youtube.com/@sourcechannel" required /><button className="button button-primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <>Connect source <ArrowRight /></>}</button></form>{notice && <p className="form-notice">{notice}</p>}<small>You can add or remove more source channels later.</small></section>;
}
