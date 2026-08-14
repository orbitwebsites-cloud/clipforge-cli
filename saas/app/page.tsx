import Link from 'next/link';
import { ArrowRight, BarChart3, Captions, Check, Clock3, Eye, Play, ShieldCheck, Sparkles, Users, WandSparkles, X, Zap } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="landing-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <nav className="marketing-nav">
        <Link className="brand" href="/"><span className="brand-mark"><Play size={16} fill="currentColor" /></span>ClipForge <em>Cloud</em></Link>
        <div className="nav-links"><a href="#how">How it works</a><a href="#compare">Why ClipForge</a><a href="#pricing">Pricing</a></div>
        <Link className="button button-ghost" href="/sign-in">Sign in</Link>
      </nav>

      <section className="hero">
        <div className="eyebrow"><Sparkles size={14} /> The Shorts engine that keeps running</div>
        <h1>Stop making clips.<br /><span>Wake up to them.</span></h1>
        <p>Generic clippers wait for another link. ClipForge monitors your YouTube and Twitch sources, learns from the Shorts that win, and keeps your destination channel publishing—with automatic or review-first control.</p>
        <div className="hero-actions">
          <Link className="button button-primary button-large" href="/sign-up">Put My Shorts on Autopilot <ArrowRight size={18} /></Link>
          <a className="button button-ghost button-large" href="#compare">Compare the workflow</a>
        </div>
        <div className="hero-proof"><span><i className="pulse" /> New uploads detected automatically</span><span>Pay for published Shorts, not input minutes</span><span>Performance learning built in</span></div>
      </section>

      <section className="advantage-section" id="compare">
        <div className="advantage-copy"><p className="overline">An engine, not another editor tab</p><h2>Other tools generate projects. ClipForge runs the publishing system.</h2><p>Keep the original voice. Skip fake narration. Choose full autopilot or approve privately. Either way, every source stays monitored after setup.</p><Link className="button button-dark" href="/sign-up">Build My Publishing Engine <ArrowRight size={17} /></Link></div>
        <div className="comparison-card">
          <div className="comparison-head"><span>Workflow</span><b>ClipForge</b><span>Paste-and-generate</span></div>
          {[
            ['Keeps watching sources after setup', true, false],
            ['Handles uploads and completed streams', true, false],
            ['Automatic or private-review delivery', true, false],
            ['Uses channel results in future selection', true, false],
            ['Usage measured in finished Shorts', true, false],
            ['Visible Creator delivery target', true, false],
          ].map(([label, us, them]) => <div className="comparison-row" key={String(label)}><span>{label}</span><b>{us ? <Check /> : <X />}</b><span>{them ? <Check /> : <X />}</span></div>)}
        </div>
      </section>

      <section className="power-grid">
        <article><WandSparkles /><p className="overline">Performance learning</p><h3>Your winners train the next batch.</h3><p>Recent views, average watch time, and engagement become evidence for future moment selection.</p></article>
        <article><Eye /><p className="overline">Review when you want</p><h3>Autopilot without surrendering control.</h3><p>Publish immediately or upload privately and send the winners live from your ClipForge dashboard.</p></article>
        <article><Captions /><p className="overline">Brand presets</p><h3>Impact, clean, or minimal.</h3><p>Set caption density, highlight color, clip count, duration, and hashtags once. Every new job follows the recipe.</p></article>
        <article><BarChart3 /><p className="overline">Closed-loop analytics</p><h3>Know which Shorts earn the next upload.</h3><p>Track views, watch time, engagement, subscriber growth, and every ClipForge Short in one place.</p></article>
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
        <article className="feature-card feature-main"><div className="feature-icon"><Clock3 /></div><p className="overline">Deadline-aware</p><h2>Every Creator job races a visible three-hour target.</h2><p>Workers process the oldest deadline first. You see detection, transcription, selection, rendering, and publishing as they happen.</p><div className="mini-clock"><span>02:17:42</span><small>remaining</small><i /></div></article>
        <article className="feature-card"><div className="feature-icon purple"><Captions /></div><p className="overline">Your proven format</p><h2>Source audio. Sharp captions.</h2><p>No fake narration. Clips keep the creator’s original voice and add readable, phrase-level captions.</p></article>
        <article className="feature-card"><div className="feature-icon red"><ShieldCheck /></div><p className="overline">Native publishing</p><h2>Automatic or review-first.</h2><p>Secure Google OAuth can publish while you are away, or hold every Short privately until you approve it.</p></article>
      </section>

      <section className="pricing-section" id="pricing">
        <div><p className="overline">Simple pricing</p><h2>Choose how fast you want to grow.</h2><p className="pricing-intro">Start free. Upgrade when Shorts become part of your growth engine.</p></div>
        <article className="price-card free-plan"><div><span>Free</span><h3>$0<small>/month</small></h3><p>Test the full workflow on one channel.</p><ul><li><Check /> 10 published Shorts monthly</li><li><Check /> 1 monitored source channel</li><li><Check /> Automatic captions and publishing</li><li><Check /> Standard processing queue</li></ul></div><Link className="button button-ghost" href="/sign-up">Start Free <ArrowRight size={17} /></Link></article>
        <article className="price-card creator-plan"><div><span className="popular-label"><Zap /> Solo creator engine</span><h3>$49<small>/month</small></h3><div className="annual-offer"><b>$520/year</b><span>Save $68</span></div><p>Run a dependable Shorts pipeline across your own content network.</p><ul><li><Check /> 150 published or review-ready Shorts monthly</li><li><Check /> 5 continuously monitored YouTube or Twitch sources</li><li><Check /> Priority queue with 3-hour target</li><li><Check /> Performance learning from recent winners</li><li><Check /> Automatic or private-review publishing</li><li><Check /> Caption, color, duration, and hashtag presets</li><li><Check /> Channel growth and per-Short analytics</li><li><Check /> Original audio—no forced AI voice-over</li></ul></div><Link className="button button-primary" href="/sign-up">Start My Publishing Engine <ArrowRight size={17} /></Link></article>
        <article className="price-card clipping-plan"><div><span className="popular-label"><Users /> Clipper roster plan</span><h3>$89<small>/month</small></h3><p>Built for clipping operators managing more creators without building more workflows.</p><ul><li><Check /> 15 continuously monitored YouTube or Twitch sources</li><li><Check /> 150 published or review-ready Shorts monthly</li><li><Check /> Upload, stream replay, and Twitch VOD monitoring</li><li><Check /> Priority queue with 3-hour target</li><li><Check /> Separate automatic or review-first control</li><li><Check /> Performance learning from channel winners</li><li><Check /> Brand and caption presets</li><li><Check /> Full destination analytics</li></ul></div><Link className="button button-primary" href="/sign-up">Build My Clipping Roster <ArrowRight size={17} /></Link></article>
      </section>

      <section className="creator-proof">
        <div><p className="overline">Built for consistent output</p><h2>Creator keeps publishing while you keep creating.</h2></div>
        <div className="creator-benefits"><article><b>5×</b><h3>More sources</h3><p>Monitor your main channel, stream archive, podcast, and collaborator channels from one dashboard.</p></article><article><b>15×</b><h3>More monthly output</h3><p>Move from 10 free Shorts to as many as 150 published Shorts every month.</p></article><article><b>&lt;3h</b><h3>Priority delivery target</h3><p>Creator jobs move ahead of the standard queue so timely uploads stay timely.</p></article></div>
        <Link className="button button-primary button-large" href="/sign-up">Put My Channel on Autopilot <ArrowRight size={18} /></Link>
      </section>
      <footer><span>© 2026 ClipForge Cloud</span><span>Built around YouTube’s official OAuth and push APIs.</span></footer>
    </main>
  );
}
