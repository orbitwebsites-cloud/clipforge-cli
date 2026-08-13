/**
 * Live test for the Deepgram transcription path. Needs DEEPGRAM_API_KEY.
 *
 * Asserts the exact contract ClipForge's stitchChunkResults() relies on:
 * res.language, res.duration, res.text, res.words[].{word,start,end} and
 * res.segments[].{text,start,end}. A drift here corrupts every clip's timing
 * silently, so the shape is checked field by field rather than eyeballed.
 */
import assert from 'node:assert/strict';
import { startProxy } from '../src/proxy.js';
import { config } from '../src/config.js';

const SAMPLE = 'https://dpgr.am/spacewalk.wav'; // ~26 s of speech, Deepgram's own fixture

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
};

async function main() {
  if (!config.deepgramKey) {
    console.log('SKIP: DEEPGRAM_API_KEY not set');
    return;
  }

  console.log('\nfetching sample audio');
  const audio = Buffer.from(await (await fetch(SAMPLE)).arrayBuffer());
  console.log(`  ${(audio.length / 1048576).toFixed(2)} MB`);

  const { server, port } = await startProxy({ port: 8801, log: () => {} });

  // Post exactly what ClipForge posts: OpenAI multipart, whisper model name.
  const form = new FormData();
  form.append('file', new File([audio], 'audio.wav', { type: 'audio/wav' }));
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  form.append('language', 'en');

  console.log('\nproxy /v1/audio/transcriptions');
  const res = await fetch(`http://127.0.0.1:${port}/v1/audio/transcriptions`, { method: 'POST', body: form });
  const body = await res.json();

  await check('responds 200', () => assert.equal(res.status, 200));
  await check('has non-empty text', () => assert.ok(body.text && body.text.length > 20, `text was ${JSON.stringify(body.text)}`));
  await check('reports duration', () => assert.ok(body.duration > 0, `duration was ${body.duration}`));
  await check('reports language', () => assert.ok(typeof body.language === 'string' && body.language.length));

  await check('words carry word/start/end', () => {
    assert.ok(Array.isArray(body.words) && body.words.length > 5, `got ${body.words?.length} words`);
    for (const w of body.words) {
      assert.equal(typeof w.word, 'string');
      assert.equal(typeof w.start, 'number');
      assert.equal(typeof w.end, 'number');
    }
  });
  await check('segments carry text/start/end', () => {
    assert.ok(Array.isArray(body.segments) && body.segments.length > 0, `got ${body.segments?.length} segments`);
    for (const s of body.segments) {
      assert.equal(typeof s.text, 'string');
      assert.equal(typeof s.start, 'number');
      assert.equal(typeof s.end, 'number');
    }
  });

  // Timing sanity — the failure mode that silently ruins captions.
  await check('word timings are monotonic and in-bounds', () => {
    let prev = -1;
    for (const w of body.words) {
      assert.ok(w.start >= prev - 0.01, `word "${w.word}" starts at ${w.start}, before previous ${prev}`);
      assert.ok(w.end >= w.start, `word "${w.word}" ends before it starts`);
      assert.ok(w.end <= body.duration + 0.5, `word "${w.word}" ends at ${w.end}, past duration ${body.duration}`);
      prev = w.start;
    }
  });
  await check('segments span the audio without inversion', () => {
    for (const s of body.segments) assert.ok(s.end >= s.start, `segment ${s.id} inverted`);
    assert.ok(body.segments[0].start < 2, `first segment starts late at ${body.segments[0].start}`);
  });
  await check('punctuated words reach captions', () => {
    assert.ok(/[A-Z]/.test(body.words.map((w) => w.word).join(' ')), 'no capitalisation — punctuated_word was dropped');
  });

  server.close();
  console.log(`\n  text: ${body.text.slice(0, 90)}…`);
  console.log(`  ${body.words.length} words / ${body.segments.length} segments / ${body.duration.toFixed(1)}s`);
  console.log(failures ? `\n${failures} TEST(S) FAILED` : '\nALL DEEPGRAM TESTS PASSED');
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exitCode = 1;
});
