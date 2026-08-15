import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env loader — no dependency, does not clobber real env vars. */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val && process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

const CF_HOME = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
  'Programs',
  'clipforge'
);

const UNPACKED = path.join(CF_HOME, 'resources', 'app.asar.unpacked', 'node_modules');

export const paths = {
  clipforgeHome: CF_HOME,
  clipforgeExe: path.join(CF_HOME, 'ClipForge.exe'),
  ffmpeg: process.env.CFC_FFMPEG || path.join(UNPACKED, 'ffmpeg-static', 'ffmpeg.exe'),
  ffprobe: process.env.CFC_FFPROBE || path.join(UNPACKED, 'ffprobe-static', 'bin', 'win32', 'x64', 'ffprobe.exe'),
  fonts: process.env.CFC_FONTS || path.join(CF_HOME, 'resources', 'fonts'),
  settings: path.join(
    process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
    'clipforge',
    'settings.json'
  ),
  work: path.join(ROOT, 'work'),
  out: path.join(ROOT, 'out'),
};

/** Collect every configured Deepgram key, de-duplicated, primary first. */
function deepgramKeyPool() {
  const keys = [
    process.env.DEEPGRAM_API_KEY,
    ...(process.env.DEEPGRAM_API_KEYS || '').split(','),
    ...Object.keys(process.env)
      .filter((k) => /^DEEPGRAM_API_KEY_\d+$/.test(k))
      .sort((a, b) => Number(a.split('_').pop()) - Number(b.split('_').pop()))
      .map((k) => process.env[k]),
  ];
  return [...new Set(keys.map((k) => (k || '').trim()).filter(Boolean))];
}

export const config = {
  groqKey: process.env.GROQ_API_KEY || '',
  cerebrasKey: process.env.CEREBRAS_API_KEY || '',
  geminiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '',
  deepgramKey: process.env.DEEPGRAM_API_KEY || '',
  deepgramKeys: deepgramKeyPool(),
  groqBase: 'https://api.groq.com/openai/v1',
  cerebrasBase: 'https://api.cerebras.ai/v1',
  // Gemini exposes an OpenAI-compatible endpoint — same request shape, zero new parsing.
  geminiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepgramBase: 'https://api.deepgram.com/v1',
  whisperModel: process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
  deepgramModel: process.env.DEEPGRAM_MODEL || 'nova-3',
  cerebrasModel: process.env.CEREBRAS_MODEL || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  mistralKey: process.env.MISTRAL_API_KEY || '',
  mistralBase: 'https://api.mistral.ai/v1',
  mistralModel: process.env.MISTRAL_MODEL || 'mistral-small-latest',
  groqChatModel: process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-120b',
  proxyPort: Number(process.env.CFC_PROXY_PORT || 8787),
};

/**
 * Cerebras model preference order. The account's actual catalog is
 * discovered at runtime via GET /v1/models; these are ranked candidates,
 * matched as substrings so version suffixes still hit.
 */
export const CEREBRAS_PREFERENCE = [
  'qwen-3-235b-a22b-instruct',
  'llama-3.3-70b',
  'llama3.3-70b',
  'gpt-oss-120b',
  'qwen-3-32b',
  'llama-4-scout',
  'llama3.1-8b',
];
