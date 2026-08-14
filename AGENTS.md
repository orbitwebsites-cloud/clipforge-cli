# cfc — agent operating guide

A zero-dependency CLI that drives **ClipForge** (a local Electron app) to turn
long videos into vertical short clips, using **Deepgram** for transcription and
**Cerebras** for highlight ranking.

Always run commands from this directory:

```
D:\opus\clipforge-cli
```

## Ground rules

- **Do not run `npm install`.** There are zero dependencies by design (Node 22
  builtins only: `fetch`, `FormData`, `WebSocket`, `http`). Adding packages is a
  regression, and the user has a standing rule against unapproved installs.
- **Never print API key values.** Keys live in `.env` (gitignored). Mask them if
  you must show anything.
- **Verify before claiming success.** `ffmpeg` exiting 0 does not prove captions
  rendered. Probe the output (`ffprobe`) and extract a frame when the visual
  result matters.
- Shell is Windows. Use PowerShell or Git Bash, but note **`pgrep`/`/proc` do
  not see Windows processes** from Git Bash — use
  `Get-Process ClipForge` instead. `cd` state resets between calls, so use
  absolute paths or `cd` in the same command.

## Start here

```bash
node src/cli.js doctor
```

Confirms the ClipForge install, bundled ffmpeg/ffprobe/fonts, yt-dlp, both API
keys, and prints the live Cerebras model catalog.

```bash
npm test
```

Offline suite (3 files, no API keys, no network). Run after any change to
`src/proxy.js`, `src/analyze.js`, `src/captions.js`, or `src/render.js`.

## The two commands are not equivalent

| | `cfc app` | `cfc clip` |
| --- | --- | --- |
| engine | **ClipForge's own** | reimplemented in this repo |
| speaker tracking (LR-ASD), visual scoring | yes | no |
| captions | ClipForge's styles | custom ASS (Anton) |
| launches the app | yes | no |

**Default to `app`.** Use `clip` only when the user explicitly wants a
ClipForge-independent pipeline, or needs something the app's IPC surface does
not expose (e.g. custom min/max clip length, which `app` has no equivalent for).

## cfc app

```bash
node src/cli.js app "<file|url>" --n 5 --aspect 9:16 --out out/name
```

| flag | values | default |
| --- | --- | --- |
| `--n` | integer | 5 |
| `--aspect` | `9:16` `1:1` `16:9` `original` | `9:16` |
| `--type` | `auto` `talking-head` `podcast` `webinar` `product-demo` | `auto` |
| `--length` | `auto` `short` `medium` `long` | `auto` |
| `--reframe` | `crop` `fit-blur` `fit-letterbox` | ClipForge decides |
| `--framing` | `auto` (speaker tracking) `manual` | ClipForge decides |
| `--no-zoom` / `--no-captions` | flag | off |
| `--no-export` | analyze only, render nothing | off |
| `--prompt` | free text steering clip selection | — |
| `--out` | output directory | `out/app-<name>` |
| `--keep-open` | leave the app running | off |
| `--cdp-port` | debug port for this instance | 9333 |

`--type` and `--aspect` are validated against the app's real enums; anything
else throws.

**Leave `--reframe`/`--framing` unset unless the user asks.** ClipForge derives
them from the video type and the detected focus track, and blind overrides
produce worse crops. The one common exception: on gameplay/screencast content it
picks `fit-letterbox`, which yields big black bars in a 9:16 frame — pass
`--reframe crop` if the user wants the frame filled, and warn them it discards
most of the frame width and will center-crop when there is no face to track.

### How it works (do not "simplify" this)

ClipForge ships no CLI. Its main process registers a full IPC surface and its
preload mirrors it onto `window.clipforge`. So `cfc app`:

1. starts the local OpenAI-compatible router,
2. launches `ClipForge.exe --remote-debugging-port=N` with `OPENAI_BASE_URL`
   pointed at the router,
3. connects over the Chrome DevTools Protocol and calls
   `window.clipforge.createProjectFromUrl / analyzeProject / updateClip /
   exportClip`, streaming the app's `pipeline:progress` and `export:progress`
   events to stdout.

`getApiKey()` in the app falls back to `process.env.OPENAI_API_KEY`, so its
DPAPI-encrypted settings store is never touched.

Long calls run as page-side promises polled for a result, so progress can stream
while they run. Awaiting them directly would block with no visibility.

## cfc clip

```bash
node src/cli.js clip "<file|url>" --n 5 --min 15 --max 75 --dry-run
```

Flags: `--n --min --max --reframe (blur|center|left|right) --lang --out
--no-captions --dry-run --keep-work`. Use `--dry-run` to see the plan before
spending render time.

## Router (used by both, and standalone)

```bash
node src/cli.js proxy     # router only, for any OpenAI client
node src/cli.js launch    # router + the ClipForge GUI wired to it
```

Cerebras has **no audio endpoint**, and ClipForge exposes only one base URL —
that is the entire reason the router exists. It routes
`/v1/audio/transcriptions` to Deepgram and `/v1/chat/completions` to Cerebras,
remapping model names and translating `max_tokens` → `max_completion_tokens`.
The transcription leg also converts between formats in both directions:
ClipForge posts OpenAI multipart and expects `verbose_json`, Deepgram takes raw
bytes and returns its own shape (`toVerboseJson` in `src/providers.js`).
It binds loopback-only because it holds live keys, and walks forward from port
8787 if that is taken.

## Scheduled posting

Ten Windows Scheduled Tasks (`ClipForge Post 1-10`) each run
`scripts\post-next.cmd`, which uploads exactly one queued clip.

```bash
node src/cli.js app "<url>" --n 6 --reframe crop --out out/name   # generate
node src/cli.js queue add --dir out/name                          # enqueue
node src/cli.js queue                                             # status
node src/cli.js post-next                                         # post one (scheduler calls this)
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1                       # default 10 slots, 08:00-21:30
powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1 -Times 08:00,12:00,16:00,20:00
powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1 -Remove
```

Logs land in `work/logs/post-YYYY-MM-DD.log`. Queue state is `work/queue.json`.

The producer watcher (`ClipForge Watch`) checks the active creator feeds every
two minutes, processes up to two fresh videos into five captioned Shorts each,
and gives those clips priority in the publishing queue. It runs one producer at
a time, starts immediately when installed, and restarts at Windows logon. Its
logs are `work/logs/agent-watch-YYYY-MM-DD.log`; install or remove it with
`scripts\install-agent-scheduler.ps1` (`-PollSeconds 60` changes the cadence).

`post-next` takes an advisory lock (`work/queue.lock`, stale after 30 min) so
overlapping slots cannot double-post. It exits 0 on daily-ceiling failures and
leaves the item pending, so the next slot retries it; it only exits non-zero on
unexpected errors.

## Upload ceilings — two different limits

- `quotaExceeded` — the project's granular `videos.insert` allowance. Since
  June 2026 the default is 100 calls/day at one call per upload. Tracked locally
  in `work/quota.json` against **midnight US/Pacific**, not local midnight.
- `uploadLimitExceeded` — a **per-channel** cap YouTube applies to unverified or
  new channels. Tighter than the API quota and unrelated to it; more API quota
  does not help. Fix is phone verification at youtube.com/verify.

This channel is currently hitting the second one at ~4 uploads/day.

## Known traps

- **Kill stray processes before a run.** A previous run's node process can hold
  the router port and its ClipForge window can hold the CDP port:
  ```bash
  powershell -NoProfile -Command "Get-Process ClipForge -ErrorAction SilentlyContinue | Stop-Process -Force"
  ```
  There is no single-instance lock, so parallel runs are possible — but each
  needs its own `--cdp-port`.
- **Long/4K sources are slow.** The ONNX visual and layout passes plus CPU x264
  export run for minutes per clip. A 26-min 1440p video took ~13 min end to end.
  Run these in the background and poll the log; do not wrap them in a short
  timeout. Killing mid-export is handled (Ctrl+C asks the app to cancel so it
  deletes partials), but a hard `kill -9` will leave a corrupt mp4.
- **The Cerebras account does not have `llama-3.3-70b`,** despite the user's
  shared `.env.txt` naming it. Live catalog: `gpt-oss-120b`, `zai-glm-4.7`,
  `gemma-4-31b`. Leave `CEREBRAS_MODEL` blank so `resolveCerebrasModel()` picks
  from the live catalog.
- **`score` and `reason` come back null** in `clips.json` from `cfc app` —
  ClipForge does not expose them on the clip object. `cfc clip` does populate
  them. Do not present nulls as real scores.
- ffmpeg in this build **does not support `-pattern_type glob`**; use numbered
  sequences (`%02d.png`).
- The `subtitles` filter breaks on Windows drive letters, so `render.js` runs
  ffmpeg with `cwd` set to the clip work dir and uses relative paths. Keep it.

## Layout

```
src/cli.js        arg parsing, commands
src/appflow.js    cfc app orchestration (create → analyze → edit → export)
src/appdriver.js  CDP transport + window.clipforge bridge
src/proxy.js      OpenAI-compatible router (Deepgram + Cerebras)
src/analyze.js    Cerebras map/reduce ranking, JSON extraction, boundary snapping
src/transcribe.js Deepgram, single-request (no chunking)
src/render.js     ffmpeg cut / reframe / caption burn   (cfc clip only)
src/captions.js   karaoke ASS generation                (cfc clip only)
tools/unasar.js   extract app.asar to inspect ClipForge internals
```

To inspect the app's own code (IPC names, option enums, defaults):

```bash
node tools/unasar.js "C:\Users\thaku\AppData\Local\Programs\clipforge\resources\app.asar" work/_asar
```
