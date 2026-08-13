import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import './pricing.css';

export const metadata: Metadata = {
  title: 'ClipForge Cloud — Your long videos, working overtime',
  description: 'Turn every upload and stream replay into captioned YouTube Shorts within three hours.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><ClerkProvider>{children}</ClerkProvider></body></html>;
}
