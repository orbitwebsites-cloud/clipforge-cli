import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import './pricing.css';

export const metadata: Metadata = {
  title: 'ClipForge Cloud | Automatic YouTube Shorts for Creators',
  description: 'Automatically turn new YouTube uploads and livestream replays into captioned Shorts, then publish them directly to your channel.',
  openGraph: {
    title: 'Turn every YouTube upload into captioned Shorts',
    description: 'Connect your channels once. ClipForge finds the moments, adds captions, and publishes the Shorts for you.',
    type: 'website',
    url: 'https://clipforge.klippdstudio.com',
    siteName: 'ClipForge Cloud',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><ClerkProvider>{children}</ClerkProvider></body></html>;
}
