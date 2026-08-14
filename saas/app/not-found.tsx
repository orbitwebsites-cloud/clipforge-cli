import { Scissors } from 'lucide-react';
import SystemScreen from './_components/system-screen';

export default function NotFound() {
  return <SystemScreen tone="neutral" eyebrow="Timeline gap detected" code="404" title="This frame isn’t in the cut." description="The link may be old, mistyped, or moved to a different part of the workspace. Your clips and account are safe." icon={<Scissors />} primary={{ href: '/dashboard', label: 'Open dashboard' }} secondary={{ href: '/', label: 'Go home' }} />;
}
