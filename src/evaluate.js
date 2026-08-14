import { chatWithFailover } from './providers.js';
import { extractJson, ts } from './analyze.js';

const MIN_PASS = Number(process.env.AGENT_MIN_PASS || 3);
const MIN_SCORE = Number(process.env.AGENT_MIN_SCORE || 78);

const SYSTEM = `You are a viral content specialist for Minecraft SMP short-form video (YouTube Shorts / TikTok / Reels).
Your job: predict which clips will stop scrollers, get rewatched, and reach 10k+ views.

Grade each clip across 5 dimensions (0–20 each, max 100):

  ScrollStop  (0-20) – Would a thumb-scroller FREEZE on the VERY FIRST FRAME? Score 20 only if
                        there is visible physical action (explosion, sword swing, chase, build reveal,
                        player in danger) in the opening half-second. Score 0-5 for a talking head.
  Hook        (0-20) – The core conflict/stakes are unmistakably clear within the first 2 seconds.
                        No setup allowed — the viewer must feel something immediately.
  Standalone  (0-20) – Zero SMP lore needed. A random person who has never seen the channel can
                        follow and CARE about the outcome.
  Progression (0-20) – The tension escalates continuously toward a clear outcome.
                        Not static. Not recap. Every few seconds something changes.
  Rewatch     (0-20) – Is there a moment — a twist, a reaction, a near-miss — that makes the
                        viewer want to watch it again? Rewatches are the #1 signal YouTube uses
                        to push Shorts in the feed.

Mandatory deductions (applied after scoring, can go below 0):
  Talking-head open with no action in frame 1-2     -18
  Mid-sentence start or end                          -15 each
  Ad read, sponsor message, outro                    -20
  Pure context-setting, no conflict in first 5s      -18
  Revenge-story or vague drama framing               -14
  Stream downtime, chat waiting, technical issues    -15
  More than 30s without visible escalation           -12
  Near-duplicate of a better clip in this batch      -10

Proven viral formats for this channel (these score highest on average):
  Ambushes and counter-ambushes with clear victim and attacker
  Clutch escapes where death looks certain
  Betrayals at a critical item/base moment
  Timed contests with a visible countdown
  Reveals of hidden traps, hidden rooms, or secret alliances
  Eliminations that change the server balance of power

Do NOT award high scores for:
  Clips that SOUND dramatic but have no visible on-screen stakes
  Dialogue-only moments without gameplay action visible
  Clips that require knowing who everyone is to care

A clip that scores < 14 on ScrollStop should almost never reach >= {MIN_SCORE} overall.

PASS when at least {MIN_PASS} clips score >= {MIN_SCORE}. Otherwise FAIL.

Return ONLY valid JSON — no prose outside the braces:
{
  "verdict": "PASS" | "FAIL",
  "clips": [
    { "id": <integer>, "score": 0-100, "scrollStop": 0-20, "issues": ["..."], "reason": "one sentence" }
  ],
  "globalFeedback": "One or two sentences telling the generator what kinds of moments to find differently next time — focus on visual start quality and rewatch triggers."
}`;

/**
 * Evaluate a set of clips against the MC SMP viral rubric.
 *
 * Returns:
 *   verdict        – "PASS" | "FAIL"
 *   passing        – clips that met the threshold (with evalScore / evalReason attached)
 *   failing        – clips that didn't
 *   globalFeedback – evaluator's note for the next generator pass
 */
export async function evaluateClips(clips, { log = () => {} } = {}) {
  if (!clips.length) {
    return { verdict: 'FAIL', passing: [], failing: [], globalFeedback: 'No clips were generated.' };
  }

  const lines = clips.map(
    (c, i) =>
      `id=${i} [${ts(c.start)}-${ts(c.end)}] "${c.title}" :: ${(c.reason || '').slice(0, 200)}`
  );

  const res = await chatWithFailover(
    {
      temperature: 0.2,
      max_completion_tokens: Math.min(8_000, 1_500 + clips.length * 250),
      messages: [
        {
          role: 'system',
          content: SYSTEM.replace('{MIN_PASS}', MIN_PASS).replace('{MIN_SCORE}', MIN_SCORE),
        },
        { role: 'user', content: `Evaluate these ${clips.length} clips:\n${lines.join('\n')}` },
      ],
    },
    { log }
  );

  const raw = extractJson(res.choices?.[0]?.message?.content || '');
  const byId = new Map(clips.map((c, i) => [i, c]));

  const graded = (raw.clips || [])
    .map((g) => {
      const original = byId.get(Number(g.id));
      if (!original) return null;
      return {
        ...original,
        evalScore: Math.max(0, Math.min(100, Number(g.score) || 0)),
        evalIssues: Array.isArray(g.issues) ? g.issues : [],
        evalReason: String(g.reason || '').slice(0, 300),
      };
    })
    .filter(Boolean);

  const passing = graded.filter((c) => c.evalScore >= MIN_SCORE);
  const failing = graded.filter((c) => c.evalScore < MIN_SCORE);

  // Trust the model's explicit verdict; fall back to counting
  const verdict =
    raw.verdict === 'PASS' || raw.verdict === 'FAIL'
      ? raw.verdict
      : passing.length >= MIN_PASS
      ? 'PASS'
      : 'FAIL';

  return {
    verdict,
    passing,
    failing,
    globalFeedback: String(raw.globalFeedback || '').slice(0, 500),
  };
}
