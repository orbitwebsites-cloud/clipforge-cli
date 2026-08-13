import { config, CEREBRAS_PREFERENCE } from './config.js';

class HttpError extends Error {
  constructor(status, body, url) {
    super(`${status} from ${url}\n${body}`.trim());
    this.status = status;
    this.body = body;
  }
}

async function request(url, { key, method = 'GET', json, body, headers = {}, timeout = 180_000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(json ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: json ? JSON.stringify(json) : body,
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text, url);
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

/** Retry on 429 / 5xx with exponential backoff — both providers rate-limit aggressively. */
async function withRetry(fn, { tries = 4, label = 'request' } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retriable = err.status === 429 || (err.status >= 500 && err.status < 600) || err.name === 'AbortError';
      if (!retriable || i === tries - 1) break;
      const wait = Math.min(2 ** i * 1500, 20_000);
      process.stderr.write(`  ! ${label} failed (${err.status || err.name}), retrying in ${wait / 1000}s\n`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

export const groq = {
  get key() {
    if (!config.groqKey) throw new Error('GROQ_API_KEY is not set — run `cfc doctor` or edit .env');
    return config.groqKey;
  },
  models: () => request(`${config.groqBase}/models`, { key: groq.key, timeout: 20_000 }),

  /** Whisper transcription with word-level timestamps. `file` is a Blob/File. */
  async transcribe(file, { model = config.whisperModel, language, prompt } = {}) {
    const form = new FormData();
    form.append('file', file);
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    if (language) form.append('language', language);
    if (prompt) form.append('prompt', prompt);
    return withRetry(
      () => request(`${config.groqBase}/audio/transcriptions`, { key: groq.key, method: 'POST', body: form }),
      { label: 'groq/transcribe' }
    );
  },

  chat: (payload) =>
    withRetry(
      () => request(`${config.groqBase}/chat/completions`, { key: groq.key, method: 'POST', json: payload }),
      { label: 'groq/chat' }
    ),
};

export const deepgram = {
  get key() {
    if (!config.deepgramKey) throw new Error('DEEPGRAM_API_KEY is not set — run `cfc doctor` or edit .env');
    return config.deepgramKey;
  },

  /**
   * Pre-recorded transcription. `audio` is a Buffer of the encoded file, sent
   * as a raw body — Deepgram takes no multipart, and its ~2 GB ceiling means
   * even a 12 h stream goes up in one request with no chunking or stitching.
   *
   * Deepgram has no analogue to Whisper's `prompt`, so callers passing one for
   * cross-chunk continuity get it ignored; `utterances` supplies the segment
   * boundaries that Whisper returned as `segments`.
   */
  async transcribe(audio, { model = config.deepgramModel, language, contentType = 'audio/flac', timeout = 1_800_000 } = {}) {
    const qs = new URLSearchParams({ model, smart_format: 'true', punctuate: 'true', utterances: 'true' });
    // `auto` is ClipForge's sentinel for detect-language; Deepgram spells it differently.
    if (!language || language === 'auto') qs.set('detect_language', 'true');
    else qs.set('language', language);

    return withRetry(
      async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        try {
          const url = `${config.deepgramBase}/listen?${qs}`;
          const res = await fetch(url, {
            method: 'POST',
            signal: ctrl.signal,
            headers: { Authorization: `Token ${deepgram.key}`, 'Content-Type': contentType },
            body: audio,
          });
          const text = await res.text();
          if (!res.ok) throw new HttpError(res.status, text, url);
          return JSON.parse(text);
        } finally {
          clearTimeout(timer);
        }
      },
      { label: 'deepgram/transcribe' }
    );
  },
};

/**
 * Reshape a Deepgram response into OpenAI `verbose_json`.
 *
 * Deliberately narrow: ClipForge's stitcher reads only language, duration,
 * text, words[].{word,start,end} and segments[].{text,start,end}, so the
 * ceremony fields real Whisper emits (seek, tokens, avg_logprob) are omitted
 * rather than faked with values that would be wrong if anything ever read them.
 */
export function toVerboseJson(dg, { language } = {}) {
  const channel = dg?.results?.channels?.[0] || {};
  const alt = channel.alternatives?.[0] || {};

  const words = (alt.words || []).map((w) => ({
    // `punctuated_word` carries smart_format's casing and punctuation; the bare
    // `word` is lowercase and unpunctuated, which reads badly burned into captions.
    word: w.punctuated_word || w.word || '',
    start: w.start,
    end: w.end,
  }));

  let segments = (dg?.results?.utterances || []).map((u, id) => ({
    id,
    start: u.start,
    end: u.end,
    text: (u.transcript || '').trim(),
  }));

  // utterances=true is always requested, but a response without them would
  // otherwise yield zero segments and silently strip every caption line.
  if (!segments.length && words.length) {
    segments = [{ id: 0, start: words[0].start, end: words[words.length - 1].end, text: (alt.transcript || '').trim() }];
  }

  return {
    task: 'transcribe',
    language: channel.detected_language || language || 'english',
    duration: dg?.metadata?.duration ?? 0,
    text: alt.transcript || '',
    words,
    segments,
  };
}

export const cerebras = {
  get key() {
    if (!config.cerebrasKey) throw new Error('CEREBRAS_API_KEY is not set — run `cfc doctor` or edit .env');
    return config.cerebrasKey;
  },
  models: () => request(`${config.cerebrasBase}/models`, { key: cerebras.key, timeout: 20_000 }),

  chat: (payload) =>
    withRetry(
      () => request(`${config.cerebrasBase}/chat/completions`, { key: cerebras.key, method: 'POST', json: payload }),
      { label: 'cerebras/chat' }
    ),
};

/**
 * Chat with automatic failover from Cerebras to Groq.
 *
 * Cerebras meters TOKENS per minute, not requests, so batching the same work
 * into fewer calls does not help — the quota is the transcript itself. The only
 * real escapes are waiting or spending someone else's quota, and Groq serves the
 * same gpt-oss-120b, so failing over changes throughput without changing how
 * clips are judged.
 *
 * Non-quota errors are rethrown untouched: a malformed payload should surface as
 * itself, not as a second identical failure against a different vendor.
 */
export async function chatWithFailover(payload, { log = () => {} } = {}) {
  const model = await resolveCerebrasModel();
  try {
    return await cerebras.chat({ ...payload, model });
  } catch (err) {
    const quota = err.status === 429;
    if (!quota || !config.groqKey) throw err;
    log(`  cerebras quota exhausted — falling back to groq/${config.groqChatModel}`);
    try {
      return await groq.chat({ ...payload, model: config.groqChatModel });
    } catch (err2) {
      // Groq's free tier is 8k TPM and answers an over-budget request with 413,
      // not 429. Rethrowing that would report a size problem for what is really
      // a Cerebras quota problem, and would hide which provider ran out first,
      // so surface the original error with the fallback's verdict attached.
      const why = err2.status === 413 ? `too large for groq's tier (${err2.status})` : `groq also failed (${err2.status || err2.name})`;
      log(`  ! ${why} — no provider could serve this request`);
      throw err;
    }
  }
}

let resolvedModel = null;

/**
 * Pick the best available Cerebras model for this account.
 * Explicit CEREBRAS_MODEL always wins; otherwise fall back to the
 * live catalog so a renamed/retired model can't hard-break the pipeline.
 */
export async function resolveCerebrasModel() {
  if (config.cerebrasModel) return config.cerebrasModel;
  if (resolvedModel) return resolvedModel;

  let available = [];
  try {
    const res = await cerebras.models();
    available = (res.data || []).map((m) => m.id);
  } catch {
    // Catalog unreachable — fall through to first preference and let the
    // chat call surface the real error.
  }
  if (!available.length) return CEREBRAS_PREFERENCE[0];

  for (const want of CEREBRAS_PREFERENCE) {
    const hit = available.find((id) => id.toLowerCase().includes(want.toLowerCase()));
    if (hit) return (resolvedModel = hit);
  }
  return (resolvedModel = available[0]);
}
