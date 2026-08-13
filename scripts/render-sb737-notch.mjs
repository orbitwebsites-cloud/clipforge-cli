import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { probe, ensureDir } from '../src/ffmpeg.js';
import { renderClip } from '../src/render.js';

const projectId = '2a28a746-4199-4536-b9a8-bdf10240e484';
const projectDir = path.join(
  process.env.APPDATA,
  'clipforge',
  'projects',
  projectId
);
const project = JSON.parse(readFileSync(path.join(projectDir, 'project.json'), 'utf8'));
const input = project.video.path;
const outDir = ensureDir(path.resolve('out', 'sb737-notch-armour'));
const workDir = ensureDir(path.resolve('work', 'sb737-notch-armour'));
const words = project.transcript.segments
  .flatMap((segment) => segment.words || [])
  .map((word) => ({ ...word, word: word.word || word.text }));
const meta = await probe(input);

const clips = [
  {
    title: 'Minecraft Made the Strongest Armor Possible',
    start: 0,
    end: 37.8,
    score: 94,
    reason: 'Immediate escalation from normal armor to an illegal, unkillable set.',
  },
  {
    title: 'This Lava Escape Nearly Ended 10000 Days',
    start: 363.8,
    end: 389.6,
    score: 91,
    reason: 'A glitch removes the water during a hardcore lava escape.',
  },
  {
    title: 'The Nether Bridge Almost Ended Everything',
    start: 843.5,
    end: 895.5,
    score: 93,
    reason: 'A ghast attacks over lava while a 10000-day hardcore world is at stake.',
  },
  {
    title: 'The Bug That Puts Fortune on a Sword',
    start: 2235.4,
    end: 2272.6,
    score: 96,
    reason: 'A historical Minecraft bug visibly applies impossible enchantments.',
  },
  {
    title: 'Building the Most Illegal Armor in Minecraft',
    start: 3029.1,
    end: 3088.2,
    score: 97,
    reason: 'The payoff: stacking incompatible enchantments into the final armor.',
  },
];

const rendered = [];
for (const [index, clip] of clips.entries()) {
  rendered.push(
    await renderClip(input, clip, index, meta, {
      outDir,
      workDir,
      words,
      captions: true,
      reframe: 'blur',
      log: console.log,
    })
  );
}

writeFileSync(
  path.join(outDir, 'clips.json'),
  JSON.stringify(
    {
      source: 'https://www.youtube.com/watch?v=myojO0VpVYs',
      sourceChannel: 'SB737',
      project: projectId,
      status: 'source-cuts-awaiting-original-narration',
      clips: rendered.map(({ file, ...clip }) => clip),
    },
    null,
    2
  )
);
