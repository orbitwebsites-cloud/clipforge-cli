/**
 * Offline tests for the ranking layer's parsing and boundary logic —
 * the parts that break when a model wraps its JSON in prose.
 */
import assert from 'node:assert/strict';
import { extractJson, ts, excerptFor, batchByChars } from '../src/analyze.js';

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
};

console.log('\njson extraction');
check('bare array', () => assert.deepEqual(extractJson('[{"a":1}]'), [{ a: 1 }]));
check('fenced with json tag', () =>
  assert.deepEqual(extractJson('```json\n[{"a":1}]\n```'), [{ a: 1 }]));
check('fenced without tag', () => assert.deepEqual(extractJson('```\n[{"a":1}]\n```'), [{ a: 1 }]));
check('prose before and after', () =>
  assert.deepEqual(extractJson('Sure! Here you go:\n[{"a":1}]\nHope that helps.'), [{ a: 1 }]));
check('brackets inside strings do not end the scan', () =>
  assert.deepEqual(extractJson('[{"title":"how to ] fake out a parser"}]'), [
    { title: 'how to ] fake out a parser' },
  ]));
check('escaped quotes survive', () =>
  assert.deepEqual(extractJson('[{"t":"say \\"hi\\" now"}]'), [{ t: 'say "hi" now' }]));
check('nested objects', () =>
  assert.deepEqual(extractJson('noise [{"a":{"b":[1,2]}}] noise'), [{ a: { b: [1, 2] } }]));
check('object wrapper', () =>
  assert.deepEqual(extractJson('{"clips":[{"a":1}]}'), { clips: [{ a: 1 }] }));
check('no json throws a clear error', () =>
  assert.throws(() => extractJson('I could not find any clips.'), /No JSON/));
check('unterminated json throws', () =>
  assert.throws(() => extractJson('[{"a":1}'), /Unterminated/));

console.log('\ntimestamp formatting');
check('under an hour', () => assert.equal(ts(75), '1:15'));
check('over an hour', () => assert.equal(ts(3725), '1:02:05'));
check('zero', () => assert.equal(ts(0), '0:00'));
check('negative clamps', () => assert.equal(ts(-5), '0:00'));

console.log('\nreduce-pass excerpts');
const SEGS = [
  { start: 0, end: 5, text: 'Intro nobody wants.' },
  { start: 5, end: 10, text: 'The actual hook lands here.' },
  { start: 10, end: 15, text: 'And the payoff follows.' },
  { start: 15, end: 20, text: 'Unrelated tangent afterwards.' },
];
check('pulls only segments inside the range', () =>
  assert.equal(excerptFor(SEGS, 5, 15), 'The actual hook lands here. And the payoff follows.'));
check('includes a segment that straddles the boundary', () =>
  assert.equal(excerptFor(SEGS, 7, 12), 'The actual hook lands here. And the payoff follows.'));
check('truncates with an ellipsis', () => {
  const out = excerptFor(SEGS, 0, 20, 10);
  assert.equal(out.length, 10);
  assert.ok(out.endsWith('…'));
});
check('empty range yields empty string', () => assert.equal(excerptFor(SEGS, 100, 200), ''));

console.log('\nreduce-pass batching');
check('everything in one batch when under budget', () =>
  assert.equal(batchByChars(['aaa', 'bbb'], 100).length, 1));
check('splits when over budget', () => {
  const b = batchByChars(['aaaa', 'bbbb', 'cccc'], 8);
  assert.equal(b.length, 2);
  assert.deepEqual(b[0], ['aaaa', 'bbbb']);
  assert.deepEqual(b[1], ['cccc']);
});
check('never drops a line', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line-${i}`);
  assert.equal(batchByChars(lines, 20).flat().length, 50);
});
check('an oversized single line still gets a batch', () => {
  const b = batchByChars(['x'.repeat(500)], 10);
  assert.equal(b.length, 1);
  assert.equal(b[0].length, 1);
});
check('no empty batches', () =>
  assert.ok(batchByChars(Array.from({ length: 20 }, () => 'abcdefgh'), 10).every((b) => b.length)));

console.log(failures ? `\n${failures} TEST(S) FAILED` : '\nALL ANALYZE TESTS PASSED');
process.exitCode = failures ? 1 : 0;
