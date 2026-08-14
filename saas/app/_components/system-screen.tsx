import Link from 'next/link';
import { ArrowRight, Play } from 'lucide-react';
import type { ReactNode } from 'react';

type Action = { href: string; label: string };

export default function SystemScreen({ eyebrow, code, title, description, icon, tone = 'neutral', primary, secondary, children }: {
  eyebrow: string; code?: string; title: string; description: string; icon: ReactNode;
  tone?: 'success' | 'warning' | 'danger' | 'neutral'; primary: Action; secondary?: Action; children?: ReactNode;
}) {
  return (
    <main className={`system-screen system-${tone}`}>
      <div className="system-glow system-glow-one" /><div className="system-glow system-glow-two" />
      <header className="system-nav">
        <Link className="brand" href="/" aria-label="ClipForge Cloud home"><span className="brand-mark"><Play size={15} fill="currentColor" /></span>ClipForge <em>Cloud</em></Link>
        <span>System response</span>
      </header>
      <section className="system-card">
        <div className="system-visual" aria-hidden="true"><span>{icon}</span><i className="system-orbit orbit-one" /><i className="system-orbit orbit-two" /><i className="system-scan" /></div>
        <div className="system-copy">
          <p className="overline">{eyebrow}</p>{code && <strong className="system-code">{code}</strong>}<h1>{title}</h1><p>{description}</p>{children}
          <div className="system-actions"><Link className="button button-dark" href={primary.href}>{primary.label} <ArrowRight /></Link>{secondary && <Link className="button button-ghost" href={secondary.href}>{secondary.label}</Link>}</div>
        </div>
      </section>
      <footer className="system-footer"><span>ClipForge Cloud</span><span>Every upload, still working.</span></footer>
    </main>
  );
}
