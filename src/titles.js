/**
 * Hook-title rewriter for MC Shorts clips.
 *
 * The analyzer's titles are accurate but often describe the action rather than
 * creating tension: "Everyone Fails—But We Rise Again" (analysis output) tells
 * you the outcome before you click, collapsing curiosity. This stage rewrites
 * them for the proven Shorts hook pattern: concrete stakes or conflict, present
 * tense or open question, no spoilers.
 *
 * Wired in after evaluate() so only passing clips get a title rewrite — failing
 * clips are never uploaded and don't need it.
 *
 * The rewrite is a single Cerebras call for the whole batch, not one per clip,
 * to stay within the pace budget.
 */

import { chatWithFailover } from './providers.js';
import { extractJson } from './analyze.js';

const SYSTEM = `You write YouTube Shorts titles for Minecraft SMP clips.
Goal: each title must make a random viewer STOP scrolling and tap immediately.

MANDATORY RULES:
- 3-7 words total. Never exceed 7.
- Start with the conflict, challenge, or stakes. The first word creates urgency.
- NO spoilers — the payoff happens after the click, not in the title.
- Specific nouns > vague adjectives. "TNT floor trap" beats "sneaky plan".
- No hashtags, no emojis, no episode numbers, no SMP-specific lore names.
- No player names unless they add stakes (e.g. "Technoblade Ambush" is stakes; random username is not).
- Do NOT copy the original title. It was a description; this must be a hook.
- Banned words: "unexpected", "insane", "wild", "crazy", "you won't believe", "epic",
  "amazing", "unbelievable", "literally", "actually", "honestly".

PROVEN VIRAL TITLE PATTERNS (pick the best fit, do not copy verbatim):
  "X Tries to [Dangerous Thing]"     — creates immediate stakes
  "Trapped in [Specific Situation]"  — viewer wants to know escape
  "[X] vs [Y] at [Specific Moment]"  — clear conflict
  "Secret [Thing] Gets Exposed"      — curiosity gap + stakes
  "[Number] Second Decision"         — timer creates pressure
  "They Don't Know About [Thing]"    — insider advantage about to matter
  "Last [Item/Life/Base] Standing"   — scarcity creates tension

Proven hooks from this channel (style reference only):
- "Cookie's Shack Gets Raided"       — names victim + action, zero lore needed
- "Connect Four Elimination Round"   — immediate contest stakes
- "TNT Trap Underneath Their Base"   — specific, surprising, consequence visible

Return ONLY a JSON array of objects. Exact count = exact clip count.
[{"id": <integer matching the input id>, "title": "3-7 word hook"}]
No prose outside the JSON.`;

/**
 * Rewrite titles for a list of clips. Returns a new array with titles replaced;
 * falls back to the original title per-clip if the model omits it or errors.
 */
export async function rewriteTitles(clips, { log = () => {} } = {}) {
  if (!clips.length) return clips;

  const lines = clips.map((c, i) => `id=${i} original="${c.title}" excerpt="${(c.reason || '').slice(0, 120)}"`);

  let rewrites;
  try {
    log(`  rewriting ${clips.length} title(s) for Shorts hooks`);
    const res = await chatWithFailover(
      {
        temperature: 0.4,
        max_completion_tokens: 600 + clips.length * 60,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: lines.join('\n') },
        ],
      },
      { log }
    );
    const raw = extractJson(res.choices?.[0]?.message?.content || '');
    rewrites = Array.isArray(raw) ? raw : [];
  } catch (err) {
    log(`  ! title rewrite failed (${err.message.split('\n')[0]}) — keeping originals`);
    return clips;
  }

  const byId = new Map(rewrites.map((r) => [Number(r.id), String(r.title || '').trim()]));
  return clips.map((c, i) => {
    const t = byId.get(i);
    if (!t || t.length < 3 || t.split(/\s+/).length > 8) return c; // reject bad rewrites
    log(`  title: "${c.title}" → "${t}"`);
    return { ...c, title: t, originalTitle: c.title };
  });
}
