'use client';

import { RefreshCw, TriangleAlert } from 'lucide-react';

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="dashboard-error-page"><section><span><TriangleAlert /></span><p className="overline">Workspace unavailable</p><h1>The dashboard didn’t finish loading.</h1><p>Your jobs keep running in the background. Retry the data connection without restarting any active render.</p><div><button className="button button-dark" onClick={reset}><RefreshCw /> Retry dashboard</button><a className="button button-ghost" href="/">Go home</a></div></section></main>;
}
