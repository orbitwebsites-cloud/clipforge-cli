import { writeFileSync } from 'node:fs';

/** ASS colours are &HBBGGRR& — note the reversed byte order vs hex RGB. */
const ass = (hex) => {
  const h = hex.replace('#', '');
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
};

const clock = (sec) => {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
};

const escape = (t) => t.replace(/[{}]/g, '').replace(/\r?\n/g, ' ').trim();

function header({ font, fontSize, primary, outline }) {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Pop,${font},${fontSize},${ass(primary)},${ass(primary)},${ass(outline)},&H80000000,-1,0,0,0,100,100,0,0,1,7,3,2,80,80,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/**
 * Build a karaoke-style ASS file: words appear in groups, and the word
 * currently being spoken is colour-highlighted and slightly scaled up.
 */
export function writeCaptions(words, clipStart, clipEnd, file, opts = {}) {
  const {
    font = 'Anton',
    fontSize = 96,
    primary = '#FFFFFF',
    outline = '#000000',
    highlight = '#FACC15',
    groupSize = 3,
  } = opts;

  const inClip = words
    .filter((w) => w.end > clipStart && w.start < clipEnd)
    .map((w) => ({
      text: escape(w.word),
      start: Math.max(0, w.start - clipStart),
      end: Math.min(clipEnd - clipStart, w.end - clipStart),
    }))
    .filter((w) => w.text && w.end > w.start);

  const events = [];
  for (let i = 0; i < inClip.length; i += groupSize) {
    const group = inClip.slice(i, i + groupSize);
    group.forEach((word, idx) => {
      const text = group
        .map((g, j) =>
          j === idx
            ? `{\\c${ass(highlight)}\\fscx112\\fscy112}${g.text}{\\c${ass(primary)}\\fscx100\\fscy100}`
            : g.text
        )
        .join(' ');
      // Hold the last word of a group until the next group starts so there is
      // never a caption-less gap mid-sentence.
      const end = idx === group.length - 1 ? (inClip[i + groupSize]?.start ?? word.end) : group[idx + 1].start;
      events.push(
        `Dialogue: 0,${clock(word.start)},${clock(Math.max(end, word.end))},Pop,,0,0,0,,${text}`
      );
    });
  }

  writeFileSync(file, header({ font, fontSize, primary, outline }) + events.join('\n') + '\n', 'utf8');
  return { file, count: events.length };
}
