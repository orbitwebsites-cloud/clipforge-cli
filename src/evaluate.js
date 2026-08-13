import { chatWithFailover } from './providers.js';
import { extractJson, ts } from './analyze.js';

const MIN_PASS = Number(process.env.AGENT_MIN_PASS || 3);
const MIN_SCORE = Number(process.env.AGENT_MIN_SCORE || 78);

const SYSTEM = `You are a viral content specialist for Minecraft SMP short-form video (YouTube Shorts / TikTok / Reels).

Grade each clip for its viral potential in the MC SMP niche.

Score each dimension 0–25, sum to a total 0–100:
  Hook        (0-25) – Conflict, challenge, danger, or surprise is clear in the first 1-2 seconds.
  Standalone  (0-25) – A viewer who knows none of the SMP lore can follow and care.
  Progression (0-25) – The moment keeps changing toward a clear outcome; it is not static exposition.
  Payoff      (0-25) – Satisfying kill, escape, reveal, result, or reaction worth rewatching.

Automatic score deductions: ad reads (-20), mid-sentence start/end (-15 each),
pure context-setting with no payoff (-20), stream-downtime filler (-15),
vague revenge-story framing (-15), more than 32 seconds without continuous escalation (-15).

Use the channel's proven pattern as the quality bar: specific Minecraft ambushes,
contests, clutches, betrayals, eliminations, surprising rules, and reveals. Do not
award a high score merely because dialogue sounds dramatic.

PASS when at least {MIN_PASS} clips score >= {MIN_SCORE}. Otherwise FAIL.

Return ONLY valid JSON — no prose outside the braces:
{
  "verdict": "PASS" | "FAIL",
  "clips": [
    { "id": <integer>, "score": 0-100, "issues": ["..."], "reason": "one sentence" }
  ],
  "globalFeedback": "One or two sentences telling the generator what kinds of moments to find differently next time."
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
