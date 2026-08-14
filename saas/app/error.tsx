'use client';

import { RotateCcw, TriangleAlert } from 'lucide-react';
import SystemScreen from './_components/system-screen';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SystemScreen tone="danger" eyebrow="Render interrupted" title="Something slipped off the timeline." description="The workspace hit an unexpected error. Your saved clips are still there; retry the request or return to the dashboard." icon={<TriangleAlert />} primary={{ href: '/dashboard', label: 'Open dashboard' }} secondary={{ href: '/', label: 'Go home' }}><button className="system-retry" type="button" onClick={reset}><RotateCcw /> Try this screen again</button></SystemScreen>;
}
