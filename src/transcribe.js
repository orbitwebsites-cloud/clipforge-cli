import { readFile } from 'node:fs/promises';
import { config } from './config.js';
import { deepgram, toVerboseJson } from './providers.js';
import { extractAudio, sizeMB } from './ffmpeg.js';
import * as cache from './cache.js';

/**
 * Transcribe a media file to { text, words[], segments[] } with absolute
 * timestamps.
 *
 * Deepgram accepts the whole file in one request (~2 GB ceiling), so unlike
 * the Whisper path this replaced there is no splitting, no per-chunk offset
 * arithmetic, and therefore no opportunity for trailing silence to drift the
 * timeline. A 12 h stream is a single call.
 */
export async function transcribe(input, workDir, { language, log = () => {} } = {}) {
  const audio = await extractAudio(input, workDir);
  const mb = sizeMB(audio);
  log(`  audio extracted (${mb.toFixed(1)} MB, 16 kHz mono)`);

  // Check cache before hitting Deepgram. Key covers the exact audio bytes so a
  // re-encode or trim of the source correctly busts the entry.
  const key = cache.fileKey(audio);
  const cached = cache.get('transcript', key);
  if (cached) {
    log(`  transcript cache hit (${cached.segments?.length ?? 0} segments) — skipped Deepgram call`);
    return cached;
  }

  log(`  transcribing via Deepgram ${config.deepgramModel} (single request)`);
  const raw = await deepgram.transcribe(await readFile(audio), { language, log });
  const res = toVerboseJson(raw, { language });

  const words = res.words.map((w) => ({ word: w.word, start: w.start, end: w.end }));
  const segments = res.segments.map((s) => ({ start: s.start, end: s.end, text: s.text }));

  if (!segments.length && !words.length) {
    throw new Error('Transcription returned no timed output — is there speech in this file?');
  }
  log(`  transcribed ${res.duration ? `${(res.duration / 60).toFixed(1)} min` : 'audio'} -> ${segments.length} segments, ${words.length} words`);

  const result = { text: res.text, words, segments };
  cache.set('transcript', key, result);
  return result;
}
