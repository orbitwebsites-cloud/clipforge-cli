import { findHighlights, ts } from '../src/analyze.js';
// Synthetic transcript with one obviously strong moment and a lot of filler.
const lines = [
  [0,  "Um, so yeah, thanks for having me on the show today."],
  [6,  "Before we start, quick word from our sponsor, use code POD for ten percent off."],
  [14, "So, uh, where do you want to begin, I guess we could talk about anything."],
  [22, "Here is the thing nobody tells you about hiring your first employee."],
  [28, "We burned through four hundred thousand dollars in eleven months learning this."],
  [35, "The mistake was hiring for skill instead of hiring for judgment."],
  [42, "A skilled person executes your bad idea perfectly and you lose a year."],
  [49, "Someone with judgment tells you the idea is bad on day one and saves you the year."],
  [57, "That single reframe took us from six percent margin to thirty one percent."],
  [64, "Anyway, um, so that's kind of the story I guess, moving on."],
  [71, "And yeah, we should probably wrap up soon, we're almost out of time."],
];
const segments = lines.map(([start, text], i) => ({
  start, end: lines[i + 1]?.[0] ?? start + 7, text,
}));
const clips = await findHighlights({ segments }, 78, {
  count: 2, min: 15, max: 60, log: (m) => console.log(m),
});
console.log();
for (const c of clips) {
  console.log(`[${ts(c.start)}-${ts(c.end)}] score ${c.score}  "${c.title}"`);
  console.log(`   ${c.reason}`);
}
const hit = clips.some((c) => c.start >= 20 && c.start <= 36);
console.log(`\nPicked the real hook, not the sponsor read: ${hit ? 'PASS' : 'FAIL'}`);
process.exitCode = hit ? 0 : 1;
