import { config, CEREBRAS_PREFERENCE } from './config.js';
import { Semaphore } from './pool.js';

/**
 * Global gate on ranking calls.
 *
 * Cerebras meters tokens per minute, so N videos ranking at once multiply token
 * demand by N against a fixed ceiling. Measured with two concurrent videos: the
 * map pass 429s repeatedly, burns the retry budget, and falls through to Groq —
 * whose free tier is 8k TPM and smaller still, so the batch ends up ranked by
 * the weaker lane precisely when throughput matters.
 *
 * Serialising here costs nothing in wall-clock: ranking is a small fraction of a
 * video's runtime, and the download/transcribe/render stages still overlap
 * freely across videos. It only stops them colliding on the one metered resource.
 */
const LLM_CONCURRENCY = Number(process.env.CFC_LLM_CONCURRENCY || 1);
const llmGate = new Semaphore(LLM_CONCURRENCY);

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
async function withRetry(fn, { tries = 4, label = 'request', retryable = () => true } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retriable =
        (err.status === 429 || (err.status >= 500 && err.status < 600) || err.name === 'AbortError') &&
        retryable(err);
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

/**
 * Index of the Deepgram key currently believed good.
 *
 * Sticky on purpose: once a key is exhausted it stays exhausted for the rest of
 * the run, so restarting the search at zero on every clip would pay a guaranteed
 * failed request per call for the whole batch.
 */
let dgKeyIndex = 0;

/**
 * Errors that mean "this key is done" rather than "try again in a moment".
 * 401 invalid, 402 out of credit, 403 wrong scope — none improve with backoff,
 * so they advance the pool instead of burning the retry budget.
 */
const KEY_FATAL = new Set([401, 402, 403]);

export const deepgram = {
  get key() {
    const pool = config.deepgramKeys;
    if (!pool.length) throw new Error('DEEPGRAM_API_KEY is not set — run `cfc doctor` or edit .env');
    return pool[Math.min(dgKeyIndex, pool.length - 1)];
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
  async transcribe(audio, { model = config.deepgramModel, language, contentType = 'audio/flac', timeout = 1_800_000, log = () => {} } = {}) {
    const qs = new URLSearchParams({ model, smart_format: 'true', punctuate: 'true', utterances: 'true' });
    // `auto` is ClipForge's sentinel for detect-language; Deepgram spells it differently.
    if (!language || language === 'auto') qs.set('detect_language', 'true');
    else qs.set('language', language);

    const post = (key) =>
      withRetry(
        async () => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeout);
          try {
            const url = `${config.deepgramBase}/listen?${qs}`;
            const res = await fetch(url, {
              method: 'POST',
              signal: ctrl.signal,
              headers: { Authorization: `Token ${key}`, 'Content-Type': contentType },
              body: audio,
            });
            const text = await res.text();
            if (!res.ok) throw new HttpError(res.status, text, url);
            return JSON.parse(text);
          } finally {
            clearTimeout(timer);
          }
        },
        // A key-fatal status must not be retried against the same key — it will
        // fail identically four times and delay the failover by ~30 s.
        { label: 'deepgram/transcribe', retryable: (err) => !KEY_FATAL.has(err.status) }
      );

    const pool = config.deepgramKeys;
    if (!pool.length) throw new Error('DEEPGRAM_API_KEY is not set — run `cfc doctor` or edit .env');

    let lastErr;
    // Start at the last-known-good key and try each remaining one once.
    for (let i = dgKeyIndex; i < pool.length; i++) {
      try {
        const out = await post(pool[i]);
        dgKeyIndex = i;
        return out;
      } catch (err) {
        lastErr = err;
        const exhausted = KEY_FATAL.has(err.status) || err.status === 429;
        if (!exhausted || i === pool.length - 1) break;
        log(`  deepgram key ${i + 1}/${pool.length} unusable (${err.status}) — switching to key ${i + 2}`);
      }
    }
    throw lastErr;
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

export const mistral = {
  get key() {
    if (!config.mistralKey) throw new Error('MISTRAL_API_KEY is not set');
    return config.mistralKey;
  },

  chat: (payload) =>
    withRetry(
      () => request(`${config.mistralBase}/chat/completions`, {
        key: mistral.key,
        method: 'POST',
        json: { ...payload, model: config.mistralModel },
      }),
      { label: 'mistral/chat' }
    ),
};

export const gemini = {
  get key() {
    if (!config.geminiKey) throw new Error('GEMINI_API_KEY is not set — add it to .env or run `cfc doctor`');
    return config.geminiKey;
  },

  chat: (payload) =>
    withRetry(
      () => request(`${config.geminiBase}/chat/completions`, {
        key: gemini.key,
        method: 'POST',
        // Gemini Flash doesn't need a temperature nudge — strip unsupported fields
        json: { ...payload, model: config.geminiModel },
      }),
      { label: 'gemini/chat' }
    ),
};

/**
 * Chat with automatic failover: Gemini 2.0 Flash → Cerebras → Groq.
 *
 * Gemini is primary: 1M free tokens/day, better structured JSON than Llama,
 * and OpenAI-compatible so the payload passes through unchanged.
 * Cerebras and Groq are retained as fallbacks for quota exhaustion (429).
 */
export async function chatWithFailover(payload, { log = () => {} } = {}) {
  return llmGate.run(() => chatOnce(payload, { log }));
}

async function chatOnce(payload, { log }) {
  // 1. Try Gemini first (best free tier + quality)
  if (config.geminiKey) {
    try {
      return await gemini.chat(payload);
    } catch (err) {
      if (err.status !== 429 && err.status !== 503) throw err;
      log(`  gemini quota/unavailable (${err.status}) — falling back to cerebras`);
    }
  }

  // 2. Cerebras fallback
  if (config.cerebrasKey) {
    const model = await resolveCerebrasModel();
    try {
      return await cerebras.chat({ ...payload, model });
    } catch (err) {
      if (err.status !== 429) throw err;
      log(`  cerebras quota exhausted — falling back to groq/${config.groqChatModel}`);
    }
  }

  // 3. Mistral fallback
  if (config.mistralKey) {
    try {
      return await mistral.chat(payload);
    } catch (err) {
      if (err.status !== 429) throw err;
      log(`  mistral quota exhausted — falling back to groq`);
    }
  }

  // 4. Groq last resort
  if (!config.groqKey) throw new Error('All LLM providers exhausted — set at least one of GEMINI_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY');
  try {
    return await groq.chat({ ...payload, model: config.groqChatModel });
  } catch (err2) {
    const why = err2.status === 413 ? `too large for groq free tier` : `groq failed (${err2.status || err2.name})`;
    log(`  ! ${why} — all 4 providers failed`);
    throw err2;
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
