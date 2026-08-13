/**
 * Test for the Cerebras -> Groq failover. Needs GROQ_API_KEY only.
 *
 * The Cerebras side is fault-injected rather than genuinely exhausted. Draining
 * the real quota is not a reliable lever: Cerebras rejects a request whose token
 * count exceeds the REMAINING budget, so an oversized request is refused without
 * metering anything, and a small one fits almost regardless of how drained the
 * bucket is. Pointing the base URL at a server that always answers 429 tests the
 * branch that matters, deterministically and without burning quota.
 */
import http from 'node:http';
import assert from 'node:assert/strict';
import { chatWithFailover } from '../src/providers.js';
import { config } from '../src/config.js';

if (!config.groqKey) {
  console.log('SKIP: needs GROQ_API_KEY');
  process.exit(0);
}

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

/** A stand-in Cerebras that always fails with `status`. */
function stubCerebras(status, body) {
  const server = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'gpt-oss-120b' }] }));
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  );
}

const savedBase = config.cerebrasBase;
const savedKey = config.cerebrasKey;
const savedModel = config.cerebrasModel;
config.cerebrasKey = 'stub-key';
config.cerebrasModel = 'gpt-oss-120b'; // skip catalog resolution against the stub

const small = {
  temperature: 0,
  // gpt-oss spends completion tokens on reasoning before emitting content, so a
  // tight budget returns "" and reads as a transport failure when nothing is wrong.
  max_completion_tokens: 400,
  messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
};

console.log('\ncerebras 429 -> groq');
{
  const { server, port } = await stubCerebras(429, {
    error: { message: 'Tokens per minute limit exceeded', code: 'token_quota_exceeded' },
  });
  config.cerebrasBase = `http://127.0.0.1:${port}/v1`;
  const logs = [];
  const res = await chatWithFailover(small, { log: (m) => logs.push(m) });
  const text = res.choices?.[0]?.message?.content ?? '';

  await check('falls back to groq', () =>
    assert.ok(logs.some((m) => /falling back to groq/.test(m)), `logs: ${logs.join(' | ')}`));
  await check('returns a usable completion', () => assert.ok(text.trim().length, 'empty content'));
  console.log(`        groq said: ${JSON.stringify(text.trim().slice(0, 40))}`);
  server.close();
}

console.log('\nnon-quota errors are NOT failed over');
{
  const { server, port } = await stubCerebras(400, { error: { message: 'malformed payload' } });
  config.cerebrasBase = `http://127.0.0.1:${port}/v1`;
  const logs = [];
  await check('a 400 rethrows instead of retrying on groq', async () => {
    await assert.rejects(
      () => chatWithFailover(small, { log: (m) => logs.push(m) }),
      (e) => e.status === 400
    );
    assert.ok(!logs.some((m) => /falling back/.test(m)), 'should not have failed over');
  });
  server.close();
}

config.cerebrasBase = savedBase;
config.cerebrasKey = savedKey;
config.cerebrasModel = savedModel;

console.log(failures ? `\n${failures} TEST(S) FAILED` : '\nALL FAILOVER TESTS PASSED');
process.exitCode = failures ? 1 : 0;
