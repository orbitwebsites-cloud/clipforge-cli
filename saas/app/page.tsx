import Link from 'next/link';
import { ArrowRight, Captions, Check, Clock3, Play, Sparkles, Tv, Zap } from 'lucide-react';

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
        <p>Connect your YouTube channels once. ClipForge finds the strongest moments, adds sharp captions, and publishes the Shorts for you. Creator jobs get priority delivery within three hours.</p>
        <div className="hero-actions">
          <Link className="button button-primary button-large" href="/sign-up">Create My First Shorts <ArrowRight size={18} /></Link>
          <a className="button button-ghost button-large" href="#how">See how it works</a>
        </div>
        <div className="hero-proof"><span><i className="pulse" /> Creator priority queue</span><span>Original audio + captions</span><span>Direct YouTube publishing</span></div>
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
        <div><p className="overline">Simple pricing</p><h2>Choose how fast you want to grow.</h2><p className="pricing-intro">Start free. Upgrade when Shorts become part of your growth engine.</p></div>
        <article className="price-card free-plan"><div><span>Free</span><h3>$0<small>/month</small></h3><p>Test the full workflow on one channel.</p><ul><li><Check /> 10 published Shorts monthly</li><li><Check /> 1 monitored source channel</li><li><Check /> Automatic captions and publishing</li><li><Check /> Standard processing queue</li></ul></div><Link className="button button-ghost" href="/sign-up">Start Free <ArrowRight size={17} /></Link></article>
        <article className="price-card creator-plan"><div><span className="popular-label"><Zap /> Most popular</span><h3>$49<small>/month</small></h3><div className="annual-offer"><b>$520/year</b><span>Save $68</span></div><p>For creators who want a dependable Shorts engine running every day.</p><ul><li><Check /> 150 published Shorts monthly</li><li><Check /> 5 monitored source channels</li><li><Check /> Priority queue with 3-hour target</li><li><Check /> New uploads + livestream replays</li><li><Check /> Original audio with burned captions</li><li><Check /> Direct automatic YouTube publishing</li></ul></div><Link className="button button-primary" href="/sign-up">Try Creator Free for 7 Days <ArrowRight size={17} /></Link></article>
      </section>

      <section className="creator-proof">
        <div><p className="overline">Built for consistent output</p><h2>Creator keeps publishing while you keep creating.</h2></div>
        <div className="creator-benefits"><article><b>5×</b><h3>More sources</h3><p>Monitor your main channel, stream archive, podcast, and collaborator channels from one dashboard.</p></article><article><b>15×</b><h3>More monthly output</h3><p>Move from 10 free Shorts to as many as 150 published Shorts every month.</p></article><article><b>&lt;3h</b><h3>Priority delivery target</h3><p>Creator jobs move ahead of the standard queue so timely uploads stay timely.</p></article></div>
        <Link className="button button-primary button-large" href="/sign-up">Start the 7-Day Creator Trial <ArrowRight size={18} /></Link>
      </section>
      <footer><span>© 2026 ClipForge Cloud</span><span>Built around YouTube’s official OAuth and push APIs.</span></footer>
    </main>
  );
}
