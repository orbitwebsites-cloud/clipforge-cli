import { chatWithFailover, resolveCerebrasModel } from './providers.js';

/**
 * Map-pass window size, set by the SMALLER of the two providers.
 *
 * Cerebras serves 60k chars fine and only trips its quota near 100k, so on its
 * own this could be much larger. Groq's free tier is the binding constraint:
 * 8000 tokens per minute, and an over-budget request there returns 413, which is
 * not retryable — so a window sized for Cerebras makes the failover useless
 * exactly when it is needed.
 *
 * 14k chars is roughly 3.5k tokens, which leaves headroom for the system prompt
 * and the completion inside Groq's 8k. Raising this without raising the Groq
 * tier silently converts the fallback into a hard failure.
 */
const WINDOW_CHARS = 14_000;
const OVERLAP_CHARS = 1_500;

// Budget for one reduce-pass prompt. Same conservatism as WINDOW_CHARS: the
// candidate list is far denser than transcript prose, so overshooting here
// fails the whole ranking rather than one window.
const REDUCE_CHARS = 12_000;
const EXCERPT_CHARS = 220; // enough to judge a hook without paying for the whole clip

export const ts = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
};

const parseTs = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return NaN;
  const parts = v.trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

/** Pull the first JSON array or object out of a model response. */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error(`No JSON in model response:\n${text.slice(0, 400)}`);
  const open = body[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error(`Unterminated JSON in model response:\n${text.slice(0, 400)}`);
}

const SYSTEM = `You find self-contained viral short-form clips inside long videos.

Rules:
- A clip must make complete sense to someone who has NOT seen the rest of the video.
- Start ON visible action, conflict, a challenge, or a surprising claim. The first 1-2 seconds must create a question or stakes; never spend them explaining context.
- Never start mid-sentence or on filler ("so", "um", "and yeah").
- End on a punchline, payoff, or a clean statement. Never end mid-sentence.
- Prefer: ambushes, betrayals, clutch escapes, eliminations, contests, puzzles, surprising rules, reveals, strong reactions, and clear before/after outcomes.
- For Minecraft, favor moments whose stakes are understandable from the gameplay itself and which visibly progress every few seconds.
- Prefer the shortest range that preserves the hook and payoff. A complete 15-31 second story beats a longer version with setup.
- Reject: rambling, throat-clearing, pure context-setting, ad reads, intros/outros.
- Clip length must be between {MIN} and {MAX} seconds.
- Titles must be 3-7 concrete words, name the conflict/challenge, and create curiosity without lying. Avoid vague revenge formulas, hashtags, episode lore, and generic words such as "unexpected moments".

Return ONLY a JSON array. Each element:
{"start":"M:SS","end":"M:SS","title":"punchy 3-7 word hook","score":0-100,"reason":"why this works, one sentence"}
Order by score, best first. No prose outside the JSON.`;

function buildTranscript(segments) {
  return segments.map((s) => `[${ts(s.start)}] ${s.text}`).join('\n');
}

/** The spoken text inside a clip's range, truncated for the reduce prompt. */
export function excerptFor(segments, start, end, limit = EXCERPT_CHARS) {
  const text = segments
    .filter((s) => s.end > start && s.start < end)
    .map((s) => s.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * Pack candidates into reduce-pass batches that respect REDUCE_CHARS.
 *
 * Always returns at least one batch, and never emits an empty one — a single
 * candidate whose rendered line exceeds the budget still gets its own batch
 * rather than being silently dropped.
 */
export function batchByChars(lines, limit = REDUCE_CHARS) {
  const batches = [];
  let cur = [];
  let size = 0;
  for (const line of lines) {
    if (cur.length && size + line.length > limit) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(line);
    size += line.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

function windows(text) {
  if (text.length <= WINDOW_CHARS) return [text];
  const out = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + WINDOW_CHARS));
    i += WINDOW_CHARS - OVERLAP_CHARS;
  }
  return out;
}

async function askCerebras(transcript, count, min, max, log = () => {}, critique = null, performanceBrief = '') {
  const preamble = [
    performanceBrief ? `This channel's recent performance signals:\n${performanceBrief}\nUse these signals as evidence, but never copy a title or force a weak match.` : '',
    critique ? `Evaluator feedback on the previous attempt:\n${critique}\nUse this to find DIFFERENT and BETTER moments.` : '',
  ].filter(Boolean).join('\n\n');
  const res = await chatWithFailover(
    {
      temperature: 0.3,
      max_completion_tokens: 4000,
      messages: [
        { role: 'system', content: SYSTEM.replace('{MIN}', min).replace('{MAX}', max) },
        {
          role: 'user',
          content: `${preamble ? `${preamble}\n\n` : ''}Find up to ${count} clips in this transcript.\n\n<transcript>\n${transcript}\n</transcript>`,
        },
      ],
    },
    { log }
  );
  const text = res.choices?.[0]?.message?.content || '';
  const raw = extractJson(text);
  return Array.isArray(raw) ? raw : raw.clips || [];
}

const SYSTEM_RANK = `You are choosing which short-form clips to publish from a single long video.

You will see candidate clips that were found by scanning different parts of the video
INDEPENDENTLY, so their existing scores are NOT comparable to each other. Ignore them.
Re-judge every candidate against every other on one consistent scale.

Rank on: immediate conflict/challenge in the first 1-2 seconds, whether it stands alone
without SMP lore, visible progression, a concrete payoff, specificity, and rewatchability.
Prefer complete 15-31 second stories. Penalise context-first openings, vague revenge-story
titles, mild takes, setup with no payoff, static exposition, and near-duplicates of a
stronger candidate. For Minecraft, ambushes, contests, clutches, betrayals, eliminations,
surprising rules, and reveals are the proven repeatable formats.

Return ONLY a JSON array of the best {KEEP}, best first:
[{"id":<the candidate's id>,"score":0-100,"reason":"why it beat the others, one sentence"}]
Use the full 0-100 range; do not cluster everything in the 80s. No prose outside the JSON.`;

/** One reduce call: re-score a batch of candidates against each other. */
async function askRank(items, keep, log) {
  const lines = items.map(
    (it) =>
      `id=${it.id} [${ts(it.start)}-${ts(it.end)}] "${it.title}" :: ${it.excerpt || '(no speech)'}`
  );
  const res = await chatWithFailover(
    {
      temperature: 0.2,
      // Generous on purpose: gpt-oss-class models spend completion tokens on
      // reasoning before emitting a byte of JSON, and a budget that truncates
      // mid-array surfaces as an unterminated-JSON parse failure.
      max_completion_tokens: Math.min(16_000, 2_000 + keep * 200),
      messages: [
        { role: 'system', content: SYSTEM_RANK.replace('{KEEP}', keep) },
        { role: 'user', content: `Candidates:\n${lines.join('\n')}` },
      ],
    },
    { log }
  );
  const raw = extractJson(res.choices?.[0]?.message?.content || '');
  const arr = Array.isArray(raw) ? raw : raw.clips || [];
  const byId = new Map(items.map((it) => [it.id, it]));
  const out = [];
  for (const r of arr) {
    const hit = byId.get(Number(r.id));
    if (!hit) continue; // model invented an id; drop rather than mis-attribute
    out.push({ ...hit, score: Math.max(0, Math.min(100, Number(r.score) || 0)), reason: String(r.reason || hit.reason || '').slice(0, 300) });
  }
  return out;
}

/**
 * Re-score every candidate on ONE scale.
 *
 * The map pass scores each window in isolation, so a 90 from window 3 and a 90
 * from window 40 mean nothing to each other — sorting them directly is close to
 * arbitrary over a long source. This reduce pass fixes that. When the candidate
 * list is too big for a single prompt it runs as a tournament: rank each batch,
 * carry the winners forward, repeat until one batch remains.
 */
async function rankGlobally(cands, keep, log) {
  let pool = cands.map((c, id) => ({ ...c, id }));
  for (let round = 1; ; round++) {
    const lines = pool.map((it) => `id=${it.id} [${ts(it.start)}-${ts(it.end)}] "${it.title}" :: ${it.excerpt}`);
    const batches = batchByChars(lines);

    // Terminal case, and the only one that actually re-scores: everything fits
    // in one prompt, so every candidate is judged against every other. Reached
    // directly for normal pools and after N shrinking rounds for huge ones.
    if (batches.length === 1) {
      const want = Math.min(keep, pool.length);
      log(`  global rank: ${pool.length} candidates on one scale -> top ${want}`);
      return await askRank(pool, want, log);
    }

    // Carry more than `keep` forward so the final round still has real choice.
    const perBatch = Math.max(2, Math.ceil((keep * 2) / batches.length));
    log(`  global rank round ${round}: ${pool.length} candidates in ${batches.length} batches -> top ${perBatch} each`);

    const survivors = [];
    let cursor = 0;
    for (const batch of batches) {
      const slice = pool.slice(cursor, cursor + batch.length);
      cursor += batch.length;
      try {
        survivors.push(...(await askRank(slice, Math.min(perBatch, slice.length), log)));
      } catch (err) {
        log(`  ! rank batch failed: ${err.message.split('\n')[0]} — keeping its local scores`);
        survivors.push(...slice.slice(0, perBatch));
      }
    }
    // A round that cannot shrink the pool would loop forever; cut losses and
    // let the caller sort on whatever scores we have.
    if (survivors.length >= pool.length) return survivors;
    pool = survivors;
  }
  return pool;
}

/** Drop candidates covering essentially the same range — window overlap emits these. */
function dedupeByRange(clips, tol = 2) {
  const kept = [];
  for (const c of clips) {
    if (kept.some((k) => Math.abs(k.start - c.start) <= tol && Math.abs(k.end - c.end) <= tol)) continue;
    kept.push(c);
  }
  return kept;
}

/**
 * Snap a clip's boundaries onto real segment edges so we never cut mid-word,
 * then clamp to the min/max duration budget.
 */
function snap(clip, segments, duration, min, max) {
  let start = parseTs(clip.start);
  let end = parseTs(clip.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const startSeg = segments.reduce(
    (best, s) => (Math.abs(s.start - start) < Math.abs(best - start) ? s.start : best),
    start
  );
  const endSeg = segments.reduce(
    (best, s) => (Math.abs(s.end - end) < Math.abs(best - end) ? s.end : best),
    end
  );
  if (Math.abs(startSeg - start) <= 2.5) start = startSeg;
  if (Math.abs(endSeg - end) <= 2.5) end = endSeg;

  start = Math.max(0, start - 0.15); // tiny lead-in so the first consonant survives
  end = Math.min(duration, end + 0.25);
  if (end - start < min) return null;
  if (end - start > max) end = start + max;

  return {
    start,
    end,
    title: String(clip.title || 'Untitled').slice(0, 80),
    score: Math.max(0, Math.min(100, Number(clip.score) || 0)),
    reason: String(clip.reason || '').slice(0, 300),
  };
}

const overlaps = (a, b) => a.start < b.end - 1 && b.start < a.end - 1;

// Cerebras meters tokens per minute, so the map pass is a sustained-rate problem,
// not a burst one: firing windows back-to-back drains the bucket and every later
// window pays for it in backoff. A short gap between calls costs less wall clock
// than the retries it avoids. Skipped for single-window sources and the last call.
const PACE_MS = Number(process.env.CFC_PACE_MS || 1200);
const pace = (i, total) =>
  total > 1 && i < total - 1 && PACE_MS > 0
    ? new Promise((r) => setTimeout(r, PACE_MS))
    : Promise.resolve();

export async function findHighlights(
  { segments },
  duration,
  { count = 5, min = 15, max = 75, log = () => {}, critique = null, performanceBrief = '' } = {}
) {
  const model = await resolveCerebrasModel();
  const transcript = buildTranscript(segments);
  const chunks = windows(transcript);
  log(`  ranking with Cerebras ${model}${chunks.length > 1 ? ` (${chunks.length} windows)` : ''}`);

  const candidates = [];
  for (const [i, chunk] of chunks.entries()) {
    if (chunks.length > 1) log(`  window ${i + 1}/${chunks.length}`);
    // Deliberately over-nominate. The reduce pass below can only be as good as
    // the candidate pool it sees, and snap() discards a real fraction of these
    // for failing the duration budget — asking for `count / windows` leaves the
    // ranking with nothing to choose between.
    const perWindow = chunks.length > 1 ? Math.max(6, Math.ceil((count * 3) / chunks.length) + 2) : count + 3;
    try {
      candidates.push(...(await askCerebras(chunk, perWindow, min, max, log, i === 0 ? critique : null, i === 0 ? performanceBrief : '')));
    } catch (err) {
      log(`  ! window ${i + 1} failed: ${err.message.split('\n')[0]}`);
    }
    await pace(i, chunks.length);
  }

  let snapped = dedupeByRange(
    candidates.map((c) => snap(c, segments, duration, min, max)).filter(Boolean)
  );

  // Only worth a reduce pass when the map pass actually ran in isolated windows
  // AND produced more candidates than we need — otherwise the scores are already
  // from one call and comparable.
  if (chunks.length > 1 && snapped.length > count) {
    const withText = snapped.map((c) => ({ ...c, excerpt: excerptFor(segments, c.start, c.end) }));
    // Keep more than `count` so the greedy de-overlap below still has fallbacks
    // when two winners contest the same range.
    const keep = Math.min(withText.length, count * 2);
    try {
      const ranked = await rankGlobally(withText, keep, log);
      if (ranked.length) snapped = ranked.map(({ id, excerpt, ...c }) => c);
    } catch (err) {
      log(`  ! global ranking failed: ${err.message.split('\n')[0]} — falling back to per-window scores`);
    }
  }
  snapped.sort((a, b) => b.score - a.score);

  // Greedy de-overlap: keep the highest scoring clip in any contested range.
  const picked = [];
  for (const c of snapped) {
    if (picked.some((p) => overlaps(p, c))) continue;
    picked.push(c);
    if (picked.length >= count) break;
  }
  if (!picked.length) throw new Error('No usable clips found. Try --min/--max, or a longer video.');
  return picked;
}
