# cfc — a CLI for ClipForge, on Deepgram + Cerebras

A zero-dependency CLI that gives ClipForge two things it does not ship with: a
**command-line interface** and **provider choice**.

## Two commands, two very different things

| | `cfc app` | `cfc clip` |
| --- | --- | --- |
| engine | **ClipForge's own** | reimplemented here |
| speaker tracking (LR-ASD) | yes | no |
| caption renderer | ClipForge's styles | custom ASS (Anton) |
| needs the app installed | yes | only for its ffmpeg |
| startup | launches the app | none |

**`cfc app` is the real one.** Use `cfc clip` only if you want a
ClipForge-independent pipeline or need to script something the app's IPC
surface does not expose.

## Why this exists

ClipForge 0.6.18 is an Electron GUI. It has no CLI, and it is hardwired to
OpenAI (`whisper-1` for transcription, `gpt-5.4-mini` for analysis). It does,
however, read `OPENAI_BASE_URL`, and it bundles ffmpeg 6.1.1, ffprobe, and the
Anton/Poppins fonts.

The catch: **Cerebras has no audio endpoint.** Transcription must go elsewhere,
ranking should go to Cerebras, and ClipForge only exposes one base URL. So this
package provides a local OpenAI-compatible router that fans out per endpoint:

```
                    ┌─ /v1/audio/transcriptions → Deepgram (nova-3)
ClipForge ─────────►│
OPENAI_BASE_URL     └─ /v1/chat/completions     → Cerebras (auto-selected model)
```

Deepgram speaks neither OpenAI multipart nor `verbose_json`, so the router
unwraps the upload and reshapes the reply. Transcription was previously Groq
Whisper; Deepgram replaced it because it accepts whole files (~2 GB) in one
request and meters by balance rather than audio-seconds-per-hour — which is what
makes multi-hour streams viable.

`cfc clip` skips the GUI entirely and runs the same pipeline itself.

## Setup

1. Put your keys in `.env` (copy from `.env.example`):
   ```
   DEEPGRAM_API_KEY=...
   DEEPGRAM_API_KEY_2=...   # optional, see Throughput
   CEREBRAS_API_KEY=csk-...
   ```
2. Verify everything resolves:
   ```bash
   node src/cli.js doctor
   ```

No `npm install` — this runs on Node 22's built-in `fetch`, `FormData`, and
`http`.

## Commands

```bash
# Drive the real ClipForge engine from the command line
node src/cli.js app "https://www.youtube.com/watch?v=..." --n 5 --aspect 9:16
node src/cli.js app "C:\path\to\podcast.mp4" --n 5 --framing auto --no-export
```

### How `cfc app` works

ClipForge ships no CLI, but its main process registers a complete IPC surface
(`project:create`, `project:createFromUrl`, `project:analyze`, `clip:export`,
`project:updateClip`, …) and its preload mirrors that onto `window.clipforge`.
So `cfc app`:

1. starts the Groq/Cerebras router,
2. launches `ClipForge.exe` with `--remote-debugging-port` plus
   `OPENAI_BASE_URL` pointed at the router,
3. connects over the Chrome DevTools Protocol and calls `window.clipforge.*`
   directly, streaming `pipeline:progress` and `export:progress` back to stdout.

`getApiKey()` in the app falls back to `process.env.OPENAI_API_KEY`, so no
tampering with its DPAPI-encrypted settings store is needed.

Ctrl+C calls the app's own `cancelExport`/`cancelAnalyze` so it deletes partial
files instead of leaving a corrupt mp4 behind.

```bash
# Standalone pipeline — no ClipForge engine, no speaker tracking
node src/cli.js clip "C:\path\to\podcast.mp4" --n 6 --min 20 --max 60

# Same thing straight from a URL (downloads via yt-dlp, capped at 1080p)
node src/cli.js clip "https://www.youtube.com/watch?v=..." --n 6

# See the plan without spending render time
node src/cli.js clip video.mp4 --dry-run

# Run the router alone (point any OpenAI client at http://127.0.0.1:8787/v1)
node src/cli.js proxy

# Router + open the ClipForge GUI wired to it
node src/cli.js launch
```

### clip options

| flag | default | meaning |
| --- | --- | --- |
| `--n` | 5 | how many clips to produce |
| `--min` / `--max` | 15 / 75 | clip length bounds in seconds |
| `--reframe` | `blur` | `blur`, `center`, `left`, `right` |
| `--lang` | `en` | transcription language hint |
| `--out` | `./out/<name>` | output directory |
| `--no-captions` | off | skip burned-in captions |
| `--dry-run` | off | rank only, render nothing |
| `--keep-work` | off | keep intermediate audio/subtitles |

## How the pipeline works

1. **probe** — ffprobe reads dimensions, fps, duration, stream presence.
2. **transcribe** — audio is extracted to 16 kHz mono FLAC and sent to Deepgram
   in a single request, however long the source. Word timings come back absolute,
   so there is no chunking and no timeline stitching to drift.
3. **rank** — map/reduce. The transcript goes to Cerebras in ~14k-char windows,
   each over-nominating candidates (**map**). Because every window is scored in
   isolation, those scores are not comparable across windows — a 90 from window 3
   means nothing against a 90 from window 40. So a second pass re-judges all
   surviving candidates against each other on one scale (**reduce**), batching
   into a tournament if the pool is too large for one prompt. Candidates are then
   snapped to real segment boundaries so clips never start or end mid-sentence,
   and de-overlapped greedily by score.

   The reduce pass only runs when the map pass used more than one window and
   produced more candidates than requested; a single-window source is already on
   one scale. If it fails, the pipeline falls back to per-window scores rather
   than dying.
4. **render** — each clip is cut, reframed to 1080×1920, and captions are burned
   in as karaoke-style ASS (active word highlighted and scaled up).

A `clips.json` manifest is written next to the videos with timestamps, scores,
and the reason each clip was picked.

### Reframe modes

`blur` fits the whole frame over a blurred, darkened fill — nothing is cropped.
This is the default because the CLI does not do speaker tracking; the ONNX
models ClipForge ships (LR-ASD + ultraface) are only used by the GUI. Use
`center`/`left`/`right` when you know where the subject sits.

## Tests

```bash
npm test
```

27 offline checks covering the multipart parser (binary-safe round-trip),
Cerebras param translation, HTTP routing, model-response JSON extraction, and a
real ffmpeg render verified at 1080×1920 with captions in pixels. None require
API keys.

```bash
npm run test:deepgram
```

9 live checks that post real audio through the router and assert the
Deepgram→`verbose_json` translation against the exact fields ClipForge's
stitcher reads, including word-timing monotonicity. Needs `DEEPGRAM_API_KEY`.

```bash
npm run test:rank
```

Builds a multi-window transcript with a strong moment planted late among weaker
local peaks, then asserts the reduce pass actually ran (not just started) and
surfaced it. Needs `CEREBRAS_API_KEY`.

## Throughput

Videos overlap so one video's network waits (yt-dlp, Deepgram, Cerebras) run
while another saturates the CPU with renders. Four knobs, all env vars:

| var | default | what it caps |
| --- | --- | --- |
| `CFC_VIDEO_CONCURRENCY` | 3 | videos in flight |
| `CFC_RENDER_CONCURRENCY` | 4 | simultaneous ffmpeg renders, globally |
| `CFC_LLM_CONCURRENCY` | 1 | simultaneous ranking calls |
| `CFC_YTDLP_COOKIES` | `firefox` | browser to lift YouTube cookies from; `none` to disable |

Measured on an 8-core machine, 1080p source, cheap-blur chain:

```
renders   N=1  4.3 clips/min      N=4  9.2 clips/min  (x2.13)
          N=2  5.8 clips/min      N=6  9.4 clips/min  (x2.18)
```

Render concurrency plateaus at 4 — ffmpeg already slice-threads across every
core, so extra processes only recover the single-threaded gaps (filter setup,
muxing, I/O). Six buys 2% for more memory and disk churn.

Two real videos (46 min and 39 min sources) end-to-end: **4m45s for 8 clips**.

### What actually limits a large batch

Not CPU, and not money — Deepgram's signup credit covers roughly 775 hours of
audio, and everything else is free. The ceiling is **Cerebras tokens-per-minute
on the free tier**. A single 46-minute video's map pass is six sequential
windows, which alone trips 429s; the client retries with backoff and gets
through, but concurrency multiplies token demand against a fixed limit.

`CFC_LLM_CONCURRENCY=1` exists for that reason. It does not stop the 429s — they
are inherent to the tier — but it stops concurrent videos from collectively
exhausting the quota and failing over to Groq, whose free tier is 8k TPM and
would otherwise end up ranking the batch with the weaker lane exactly when
throughput matters.

Raising `CFC_VIDEO_CONCURRENCY` past ~3 mostly buys more simultaneous 1080p
downloads on disk. A 46-minute source is ~700 MB before its audio is extracted.

### Multiple Deepgram keys

`DEEPGRAM_API_KEY_2`, `_3`, … (or `DEEPGRAM_API_KEYS=a,b,c`) are tried in order
when the one before returns 401/402/403/429, so a batch survives one key's
balance running out mid-run. Keys minted inside the *same* Deepgram project
share a balance and buy only failover, not extra credit — `doctor` prints how
many distinct projects the pool covers.

## Known limits

### Fresh-upload watcher

Install the background watcher to check every configured creator channel every
two minutes and begin producing clips from new uploads immediately:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-agent-scheduler.ps1
# Optional: poll every minute
powershell -ExecutionPolicy Bypass -File scripts\install-agent-scheduler.ps1 -PollSeconds 60
```

The watcher starts immediately, restarts at Windows logon, and keeps only one
producer active at a time. Freshly discovered clips enter the publishing queue
at priority 100, so they take the next paced posting slot without bulk-uploading
the whole batch. Logs are written to `work/logs/agent-watch-YYYY-MM-DD.log`.

- **No speaker tracking in the CLI.** See reframe modes above.
- URL input needs yt-dlp on the same Python as `python -m yt_dlp`. Override the
  interpreter with `CFC_PYTHON` if you use a venv.
- **YouTube requires cookies to download.** Without them it answers "Sign in to
  confirm you're not a bot" — and only at download time, since discovery uses a
  cheaper endpoint that still works, so it surfaces as a bare yt-dlp exit 1.
  Firefox is the default source because Chrome and Edge on Windows encrypt their
  cookie stores with app-bound DPAPI that yt-dlp cannot read (yt-dlp#10927). The
  POT-token path in `download.js` is the alternative, but it needs a bgutil
  server built at `CFC_YTDLP_POT_SERVER_HOME`.
- Deepgram bills by balance, so there is no daily audio cap to hit — but an
  exhausted balance fails outright rather than throttling. The client retries
  429/5xx with backoff.
- `cfc app` still chunks: ClipForge does its own splitting before it ever reaches
  the router, so the single-request advantage applies to `cfc clip` only.
