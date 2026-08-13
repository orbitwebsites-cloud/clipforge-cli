import Link from 'next/link';
import { ArrowRight, Captions, Clock3, Play, Sparkles, Tv } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="landing-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <nav className="marketing-nav">
        <Link className="brand" href="/"><span className="brand-mark"><Play size={16} fill="currentColor" /></span>ClipForge <em>Cloud</em></Link>
        <div className="nav-links"><a href="#how">How it works</a><a href="#pricing">Pricing</a></div>
        <Link className="button button-ghost" href="/sign-in">Sign in</Link>
      </nav>

      <section className="hero">
        <div className="eyebrow"><Sparkles size={14} /> Built for creators who ship</div>
        <h1>Your long videos,<br /><span>working overtime.</span></h1>
        <p>Connect your YouTube channel once. Every new upload or stream replay becomes a batch of captioned Shorts—selected, rendered, and posted within three hours.</p>
        <div className="hero-actions">
          <Link className="button button-primary button-large" href="/sign-up">Create your account <ArrowRight size={18} /></Link>
          <a className="button button-ghost button-large" href="#how">See how it works</a>
        </div>
        <div className="hero-proof"><span><i className="pulse" /> 3-hour delivery target</span><span>No custom voiceovers</span><span>Cancel anytime</span></div>
      </section>

      <section className="pipeline-preview" id="how">
        <div className="preview-top"><span>Automation timeline</span><b>UPLOAD DETECTED · 09:14</b></div>
        <div className="pipeline-track">
          {[
            ['01', 'Detect', 'YouTube webhook', '09:14'],
            ['02', 'Understand', 'Transcript + moments', '09:21'],
            ['03', 'Create', 'Crop + captions', '09:48'],
            ['04', 'Publish', 'Shorts go live', '10:22'],
          ].map(([n, title, sub, time], index) => <div className="pipeline-step" key={title}><span>{n}</span><div><b>{title}</b><small>{sub}</small></div><time>{time}</time>{index < 3 && <ArrowRight size={16} />}</div>)}
        </div>
      </section>

      <section className="feature-grid">
        <article className="feature-card feature-main"><div className="feature-icon"><Clock3 /></div><p className="overline">Deadline-aware</p><h2>Every job races a visible clock.</h2><p>Workers process the oldest deadline first. You see detection, transcription, rendering, and publishing as they happen.</p><div className="mini-clock"><span>02:17:42</span><small>remaining</small><i /></div></article>
        <article className="feature-card"><div className="feature-icon purple"><Captions /></div><p className="overline">Your proven format</p><h2>Source audio. Sharp captions.</h2><p>No fake narration. Clips keep the creator’s original voice and add readable, phrase-level captions.</p></article>
        <article className="feature-card"><div className="feature-icon red"><Tv /></div><p className="overline">Native publishing</p><h2>Direct to your channel.</h2><p>Secure offline OAuth lets the worker publish while you are away, with retries for quota and upload limits.</p></article>
      </section>

      <section className="pricing-section" id="pricing">
        <div><p className="overline">Simple pricing</p><h2>One upload can become a week of content.</h2></div>
        <div className="price-card"><div><span>Free</span><h3>$0<small>/month</small></h3><p>10 published Shorts monthly, one destination, and one source channel.</p></div><Link className="button button-ghost" href="/sign-up">Start free <ArrowRight size={17} /></Link></div>
        <div className="price-card"><div><span>Creator</span><h3>$49<small>/month</small></h3><p>Up to 150 published Shorts monthly, one destination, five source channels, and a three-hour processing target.</p></div><Link className="button button-primary" href="/sign-up">Start 7-day trial <ArrowRight size={17} /></Link></div>
      </section>
      <footer><span>© 2026 ClipForge Cloud</span><span>Built around YouTube’s official OAuth and push APIs.</span></footer>
    </main>
  );
}
