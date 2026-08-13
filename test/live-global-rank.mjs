/**
 * Live test for the reduce pass. Needs CEREBRAS_API_KEY.
 *
 * Builds a transcript long enough to force several independent windows, fills
 * them with mildly-interesting local peaks, and plants ONE genuinely strong
 * moment three quarters of the way in.
 *
 * Under per-window scoring alone the planted moment competes only with its own
 * neighbours, so it is not reliably surfaced — every window nominates a local
 * peak and the cross-window sort is arbitrary. The reduce pass should re-judge
 * all of them together and put the planted moment on top.
 */
import { findHighlights, ts } from '../src/analyze.js';
import { config } from '../src/config.js';

if (!config.cerebrasKey) {
  console.log('SKIP: CEREBRAS_API_KEY not set');
  process.exit(0);
}

const FILLER = [
  'So I think generally you want to be consistent about it over time.',
  'Um, and that applies to most businesses I have worked with honestly.',
  'You know, it depends a lot on your particular situation and market.',
  'We talked about this a little bit on the last episode I believe.',
  'Right, and the tooling has gotten quite a bit better in recent years.',
  'Anyway that is roughly how we approach it on our side of things.',
  'Yeah, I mean there are tradeoffs either way you decide to go.',
  'And people ask me about that constantly, almost every single week.',
];

// Mild local peaks — plausible enough that each window nominates one.
const LOCAL_PEAK = [
  'The biggest lesson is that consistency beats intensity almost every time.',
  'Most founders underestimate how long distribution actually takes to build.',
  'If you cannot explain the offer in one sentence, the offer is the problem.',
];

// The planted standout: specific, numeric, self-contained, with a real payoff.
const STANDOUT = [
  'We almost went under in March, and I have never told anyone this part.',
  'We had eleven thousand dollars left and payroll was nineteen thousand.',
  'I called every customer personally and offered two years upfront at forty percent off.',
  'Thirty one of them said yes in a single afternoon, which was four hundred grand.',
  'The lesson is that your customers will save you if you are honest early enough.',
  'Every founder waits until it is too late to make that phone call.',
];

const lines = [];
let t = 0;
const push = (text) => {
  lines.push({ start: t, end: t + 6, text });
  t += 6;
};

// ~4 windows worth of transcript, with a local peak seeded into each stretch.
for (let block = 0; block < 4; block++) {
  for (let i = 0; i < 55; i++) push(FILLER[(block * 7 + i) % FILLER.length]);
  if (block < 3) {
    for (const l of LOCAL_PEAK) push(l);
  } else {
    for (const l of STANDOUT) push(l);
  }
  for (let i = 0; i < 25; i++) push(FILLER[(block * 3 + i) % FILLER.length]);
}

const chars = lines.map((l) => l.text.length).reduce((a, b) => a + b, 0);
const standoutStart = lines.find((l) => l.text.startsWith('We almost went under')).start;
const standoutEnd = lines.find((l) => l.text.startsWith('Every founder waits')).end;

console.log(`transcript: ${lines.length} segments, ~${chars} chars, ${(t / 60).toFixed(1)} min`);
console.log(`planted standout at ${ts(standoutStart)}-${ts(standoutEnd)}\n`);

const logs = [];
const clips = await findHighlights({ segments: lines }, t, {
  count: 3,
  min: 15,
  max: 75,
  log: (m) => {
    logs.push(m);
    console.log(m);
  },
});

console.log();
for (const c of clips) {
  console.log(`[${ts(c.start)}-${ts(c.end)}] score ${c.score}  "${c.title}"`);
  console.log(`   ${c.reason}`);
}

const joined = logs.join('\n');
const multiWindow = /\d+ windows/.test(joined);
// Must have STARTED and not fallen back — the start line is logged before the
// call, so on its own it would pass even when the ranking errored out.
const reduceRan = /global rank:/.test(joined) && !/global ranking failed/.test(joined);
// Overlap against the planted range, not exact equality — boundaries get snapped.
const foundStandout = clips.some((c) => c.start < standoutEnd && c.end > standoutStart);
const spread = Math.max(...clips.map((c) => c.score)) - Math.min(...clips.map((c) => c.score));

console.log('\n---');
console.log(`multi-window map pass      : ${multiWindow ? 'yes' : 'NO'}`);
console.log(`reduce pass ran            : ${reduceRan ? 'yes' : 'NO'}`);
console.log(`score spread across picks  : ${spread}`);
console.log(`surfaced the planted moment: ${foundStandout ? 'PASS' : 'FAIL'}`);

const ok = multiWindow && reduceRan && foundStandout;
console.log(ok ? '\nGLOBAL RANKING PASSED' : '\nGLOBAL RANKING FAILED');
process.exitCode = ok ? 0 : 1;
