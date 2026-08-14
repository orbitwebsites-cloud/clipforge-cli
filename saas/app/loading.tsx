import { LoaderCircle, Play } from 'lucide-react';

export default function Loading() {
  return <main className="route-loading" aria-live="polite" aria-busy="true"><div className="route-loading-brand"><span className="brand-mark"><Play size={15} fill="currentColor" /></span> ClipForge <em>Cloud</em></div><section><span className="route-loader"><LoaderCircle /></span><p className="overline">Preparing workspace</p><h1>Pulling the next frame into place.</h1><div className="loading-progress"><i /></div><div className="loading-lines" aria-hidden="true"><i /><i /><i /></div><p>Connecting your account, queue, and latest clip state…</p></section></main>;
}
