import type { Metadata } from 'next';
import { CreditCard } from 'lucide-react';
import SystemScreen from '../_components/system-screen';

export const metadata: Metadata = { title: 'Checkout canceled | ClipForge Cloud' };

export default function CancelledPage() {
  return <SystemScreen tone="warning" eyebrow="No charge was made" title="Checkout paused. Nothing changed." description="Your current plan and clips are untouched. You can compare the plans again or go back to your workspace whenever you’re ready." icon={<CreditCard />} primary={{ href: '/dashboard?tab=billing', label: 'Return to plans' }} secondary={{ href: '/dashboard', label: 'Open dashboard' }} />;
}
