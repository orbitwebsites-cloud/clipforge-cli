'use client';

import { RotateCcw, TriangleAlert } from 'lucide-react';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body><main className="global-error-shell"><span><TriangleAlert /></span><p>CLIPFORGE / SYSTEM ERROR</p><h1>The control room needs a reset.</h1><p>Your media is safe. Reload the application to reconnect the interface.</p><button type="button" onClick={reset}><RotateCcw /> Reload ClipForge</button></main></body></html>;
}
