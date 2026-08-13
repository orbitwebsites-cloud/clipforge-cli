/**
 * Offline smoke test for the router: multipart round-trip (including binary
 * payloads), Cerebras param translation, and HTTP routing. No API keys needed.
 */
import assert from 'node:assert/strict';
import { parseMultipart, sanitizeChat, startProxy } from '../src/proxy.js';
import { config } from '../src/config.js';

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

// Build a real multipart body with Node's FormData, then parse it back.
async function buildForm() {
  const bytes = Buffer.alloc(4096);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256; // includes CRLF and '--' byte runs
  const form = new FormData();
  form.append('file', new File([bytes], 'audio.flac', { type: 'audio/flac' }));
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  const res = new Response(form);
  return {
    buf: Buffer.from(await res.arrayBuffer()),
    ctype: res.headers.get('content-type'),
    bytes,
  };
}

async function main() {
  console.log('\nmultipart parser');
  const { buf, ctype, bytes } = await buildForm();
  const boundary = ctype.match(/boundary=(?:"([^"]+)"|([^;]+))/).slice(1).find(Boolean).trim();
  const parts = parseMultipart(buf, boundary);

  await check('finds every field', () => assert.equal(parts.length, 4));
  await check('file part keeps filename and type', () => {
    const f = parts.find((p) => p.name === 'file');
    assert.equal(f.filename, 'audio.flac');
    assert.equal(f.type, 'audio/flac');
  });
  await check('binary body survives byte-for-byte', () => {
    const f = parts.find((p) => p.name === 'file');
    assert.equal(f.body.length, bytes.length);
    assert.ok(f.body.equals(bytes));
  });
  await check('scalar fields decode', () => {
    assert.equal(parts.find((p) => p.name === 'model').body.toString(), 'whisper-1');
    assert.equal(parts.find((p) => p.name === 'timestamp_granularities[]').body.toString(), 'word');
  });

  console.log('\ncerebras param translation');
  await check('max_tokens becomes max_completion_tokens', () => {
    const out = sanitizeChat({ model: 'gpt-5.4-mini', max_tokens: 900, messages: [] }, 'llama-3.3-70b');
    assert.equal(out.max_completion_tokens, 900);
    assert.equal(out.max_tokens, undefined);
    assert.equal(out.model, 'llama-3.3-70b');
  });
  await check('unsupported params are stripped', () => {
    const out = sanitizeChat({ logit_bias: { 1: 2 }, top_logprobs: 3, n: 4, messages: [] }, 'm');
    for (const k of ['logit_bias', 'top_logprobs', 'n']) assert.equal(out[k], undefined);
  });
  await check('explicit max_completion_tokens is not overwritten', () => {
    const out = sanitizeChat({ max_tokens: 100, max_completion_tokens: 500, messages: [] }, 'm');
    assert.equal(out.max_completion_tokens, 500);
  });

  console.log('\nhttp routing');
  const { server, port } = await startProxy({ port: 8799, log: () => {} });
  const get = async (p, init) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, init);
    return { status: r.status, body: await r.json() };
  };
  await check('/v1/health responds ok', async () => {
    const r = await get('/v1/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });
  await check('unknown route 404s with a message', async () => {
    const r = await get('/v1/nope');
    assert.equal(r.status, 404);
    assert.match(r.body.error.message, /No route/);
  });
  await check('/v1/embeddings reports 501 not routed', async () => {
    const r = await get('/v1/embeddings');
    assert.equal(r.status, 501);
  });
  // Force the keyless state regardless of what .env holds, so this asserts
  // behaviour rather than the machine's current configuration.
  await check('missing key surfaces as an error, not a crash', async () => {
    const saved = config.cerebrasKey;
    config.cerebrasKey = '';
    try {
      const r = await get('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.4-mini', messages: [] }),
      });
      assert.equal(r.status, 502);
      assert.match(r.body.error.message, /CEREBRAS_API_KEY/);
    } finally {
      config.cerebrasKey = saved;
    }
  });
  server.close();

  console.log(failures ? `\n${failures} TEST(S) FAILED` : '\nALL PROXY TESTS PASSED');
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exitCode = 1;
});
