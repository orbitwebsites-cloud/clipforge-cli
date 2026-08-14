import { Play } from 'lucide-react';

export default function DashboardLoading() {
  return <main className="dashboard-skeleton" aria-live="polite" aria-busy="true"><aside><div className="route-loading-brand"><span className="brand-mark"><Play size={15} fill="currentColor" /></span> ClipForge <em>Cloud</em></div><div className="skeleton-nav">{Array.from({ length: 7 }, (_, index) => <i key={index} />)}</div></aside><section><div className="skeleton-kicker shimmer" /><div className="skeleton-title shimmer" /><div className="skeleton-subtitle shimmer" /><div className="skeleton-metrics">{Array.from({ length: 4 }, (_, index) => <article className="shimmer" key={index}><i /><b /><span /></article>)}</div><article className="skeleton-job"><div><i className="shimmer" /><b className="shimmer" /></div><span className="skeleton-progress"><i /></span><div className="skeleton-stages">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div></article></section></main>;
}
