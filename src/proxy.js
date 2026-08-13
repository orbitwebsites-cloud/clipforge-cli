import http from 'node:http';
import { config } from './config.js';
import { groq, cerebras, deepgram, toVerboseJson, resolveCerebrasModel } from './providers.js';

/**
 * Local OpenAI-compatible router.
 *
 * ClipForge only exposes a single OPENAI_BASE_URL, but transcription and
 * chat have to hit different vendors (Cerebras has no audio endpoint).
 * This server presents one OpenAI surface and fans out per endpoint:
 *   /v1/audio/transcriptions -> Deepgram
 *   /v1/chat/completions     -> Cerebras
 */

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

/** Binary-safe multipart/form-data parser — enough for Whisper uploads. */
export function parseMultipart(buf, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    const start = pos + delim.length;
    if (buf.slice(start, start + 2).toString() === '--') break; // closing delimiter
    const next = buf.indexOf(delim, start);
    if (next === -1) break;
    const chunk = buf.slice(start + 2, next - 2); // strip leading and trailing CRLF
    const sep = chunk.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = chunk.slice(0, sep).toString('utf8');
      const body = chunk.slice(sep + 4);
      const name = head.match(/name="([^"]*)"/)?.[1];
      const filename = head.match(/filename="([^"]*)"/)?.[1];
      const type = head.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim();
      if (name) parts.push({ name, filename, type, body });
    }
    pos = next;
  }
  return parts;
}

/** Cerebras rejects a few OpenAI-only params; drop or translate them. */
export function sanitizeChat(payload, model) {
  const {
    model: _drop,
    max_tokens,
    logit_bias,
    top_logprobs,
    logprobs,
    n,
    frequency_penalty,
    presence_penalty,
    ...rest
  } = payload;
  const out = { ...rest, model };
  if (max_tokens != null && out.max_completion_tokens == null) out.max_completion_tokens = max_tokens;
  return out;
}

const send = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

const fail = (res, status, message) => send(res, status, { error: { message, type: 'cfc_proxy_error' } });

/**
 * ClipForge speaks OpenAI multipart and expects `verbose_json` back; Deepgram
 * speaks neither. Unwrap the upload, forward the raw bytes, and reshape the
 * reply on the way out.
 *
 * The Groq rate-limit stalling this replaced is gone deliberately: Deepgram
 * meters by balance rather than audio-seconds-per-hour, so there is no reset
 * window to wait out and no reason to hold ClipForge's request open.
 */
async function handleTranscription(req, res, log) {
  const ctype = req.headers['content-type'] || '';
  const boundary = ctype.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.slice(1).find(Boolean);
  if (!boundary) return fail(res, 400, 'Expected multipart/form-data with a boundary');

  const parts = parseMultipart(await readBody(req), boundary.trim());
  const filePart = parts.find((p) => p.name === 'file' && p.filename);
  if (!filePart) return fail(res, 400, 'No `file` field in upload');

  const field = (name) => parts.find((p) => p.name === name)?.body.toString('utf8');
  const requested = field('model') || '';
  const language = field('language');

  log(
    `  transcribe: ${requested || 'unset'} -> deepgram/${config.deepgramModel} ` +
      `(${(filePart.body.length / 1048576).toFixed(1)} MB)`
  );

  const raw = await deepgram.transcribe(filePart.body, {
    language,
    contentType: filePart.type || 'application/octet-stream',
  });
  send(res, 200, toVerboseJson(raw, { language }));
}

async function handleChat(req, res, log) {
  const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  const model = await resolveCerebrasModel();
  log(`  chat: ${payload.model || 'unset'} -> cerebras/${model}${payload.stream ? ' (stream)' : ''}`);

  const upstream = await fetch(`${config.cerebrasBase}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cerebras.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitizeChat(payload, model)),
  });

  if (!upstream.ok || !payload.stream) {
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    return res.end(text);
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  for await (const chunk of upstream.body) res.write(chunk);
  res.end();
}

async function handleModels(res) {
  const results = await Promise.allSettled([groq.models(), cerebras.models()]);
  const data = [];
  for (const [i, r] of results.entries()) {
    const owner = i === 0 ? 'groq' : 'cerebras';
    if (r.status === 'fulfilled') {
      data.push(...(r.value.data || []).map((m) => ({ ...m, owned_by: owner })));
    }
  }
  send(res, 200, { object: 'list', data });
}

export function createProxy({ log = () => {} } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname.replace(/^\/v1/, '') || '/';
    try {
      if (route === '/health') return send(res, 200, { ok: true, transcription: config.deepgramModel });
      if (route === '/models' && req.method === 'GET') return await handleModels(res);
      if (route === '/audio/transcriptions' && req.method === 'POST') return await handleTranscription(req, res, log);
      if (route === '/chat/completions' && req.method === 'POST') return await handleChat(req, res, log);
      if (route === '/completions' || route === '/embeddings') {
        return fail(res, 501, `${route} is not routed by cfc — only chat and transcription are supported`);
      }
      fail(res, 404, `No route for ${req.method} ${url.pathname}`);
    } catch (err) {
      log(`  ! ${err.message.split('\n')[0]}`);
      fail(res, 502, err.message);
    }
  });
}

function listenOnce(port, log) {
  return new Promise((resolve, reject) => {
    const server = createProxy({ log });
    server.once('error', reject);
    // Loopback only — this server holds live API keys.
    server.listen(port, '127.0.0.1', () => resolve({ server, port, baseUrl: `http://127.0.0.1:${port}/v1` }));
  });
}

/**
 * Bind the router, walking forward if the port is taken. A stale run holding
 * the default port should not be a hard failure.
 */
export async function startProxy({ port = config.proxyPort, log = () => {}, tries = 12 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      return await listenOnce(port + i, log);
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      if (i === tries - 1) throw new Error(`No free port in ${port}-${port + tries - 1} for the router`);
      log(`  port ${port + i} busy, trying ${port + i + 1}`);
    }
  }
}
