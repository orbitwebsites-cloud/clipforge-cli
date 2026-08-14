# RECOVERY — cfc (ClipForge CLI)

## State as of 2026-08-14

**Live and publishing.** 18 Shorts posted so far. The pipeline (discover →
download → transcribe → rank → render → upload) works end to end and runs
unattended. The bottleneck is no longer code.

---

## THE BINDING CONSTRAINT — read this before "fixing" throughput

**YouTube's per-channel daily upload cap is what limits output. Not API quota.
Not scheduler slots. Not the render pipeline.**

Evidence, from `work/logs/post-2026-08-13.log` (9 scheduler runs logged that
day — the 12:30 slot has no entry):

| slot  | result |
|-------|--------|
| 08:00 | posted `Jqo-wolwuc4` |
| 09:30 | posted `2kkpzCcDm-w` |
| 11:00 | FAILED — Channel upload limit reached |
| 14:00 | FAILED — Channel upload limit reached |
| 15:30 | FAILED — Channel upload limit reached |
| 17:00 | posted `YZl0ySktt7w` |
| 18:30 | FAILED — Channel upload limit reached |
| 20:00 | FAILED — Channel upload limit reached |
| 21:30 | FAILED — Channel upload limit reached |

3 uploads succeeded, 6 were rejected by YouTube with:

> Channel upload limit reached — YouTube caps uploads per channel per day,
> separately from API quota. Verify the channel at youtube.com/verify to raise
> it, or wait ~24h.

Meanwhile `work/quota.json` reads `{"day":"2026-08-13","used":3}` — 3 of the
100 daily `videos.insert` calls tracked by `src/quota.js`. **API quota is 3%
used.** The wall is YouTube's unverified-channel ceiling, roughly 3–5
uploads/day.

**Consequences:**
- Adding scheduler slots does NOT increase throughput. It only adds failed
  attempts. Ten slots produced three uploads.
- The only real fix is human phone verification at <https://youtube.com/verify>.
  Nobody but the account owner can do this. Until then, expect ~3/day.
- Do not "optimize" the render pipeline or raise `YT_DAILY_UPLOADS` hoping for
  more output. Neither is the constraint.

---

## Current queue and schedule

**Queue** (`work/queue.json`, 33 items): **18 posted, 15 pending, 0 failed.**
Posted timestamps span 2026-08-10 through 2026-08-13 (America/New_York):
4 on 08-10, 6 on 08-11, 2 on 08-12, 6 on 08-13.

Items were added on two days: 12 on 08-10 (`out/branzy`, `out/sb737-s8`) and
21 on 08-13 from agent runs (`out/agent-<videoId>/…`). So the backlog grew by
21 in a day while the channel could only drain ~3/day. Backlog outpaces
publishing by roughly 7×.

**Posting scheduler** — `scripts/install-scheduler.ps1` now registers **10**
daily slots, not 4. Default `-Times`:

```
08:00 09:30 11:00 12:30 14:00 15:30 17:00 18:30 20:00 21:30
```

Confirmed in Task Scheduler as `ClipForge Post 1 0800` … `ClipForge Post 10 2130`,
all in state `Ready`. Each runs `scripts\post-next.cmd` → `cfc post-next`,
which posts exactly one clip. Remove them all with
`install-scheduler.ps1 -Remove`.

`src/queue.js` `acquireLock()` guards against two overlapping slots
double-posting; stale locks older than 30 min are ignored.

**Channel watcher** — new since 2026-08-10. `src/agent.js` + `src/discover.js`
poll the 6 channels in `channels.json`:

SB737, FlameFrags, Branzy, Wemmbu, ClownPierce, Spoke

`scripts/agent-watch.ps1` loops forever, every `-PollSeconds` (installed at
120s), running:

```
node src\cli.js agent --n 5 --min 15 --max 32 --recent 3 --max-videos 2 --priority 100 --post
```

Installed by `scripts/install-agent-scheduler.ps1`. On this machine it fell
back to the **HKCU Run entry** path, not a Scheduled Task — there is no
`ClipForge Watch` task; `HKCU:\…\CurrentVersion\Run\ClipForgeWatch` holds the
command, and a `powershell.exe` running `agent-watch.ps1` was live (PID 13288,
started 2026-08-14 03:44). Logs land in `work/logs/agent-watch-YYYY-MM-DD.log`.

Videos already handled are recorded in `work/seen-videos.json` (29 ids at time
of writing). Every watcher cycle in `agent-watch-2026-08-13.log` (34 cycles)
and `agent-watch-2026-08-14.log` reported `3 fetched, 0 new` for all six
channels — the watcher has not queued anything new in the logged window. Note
the watcher passes `--recent 3` while the manual backfill runs used 5, which is
why those manual runs found "new" videos the watcher's narrower window had
already scrolled past.

The 21 clips added on 08-13 came from manually-invoked agent runs
(`work/logs/manual-fill-2026-08-13.out.log`, `manual-more-2026-08-13.out.log`),
which processed 3 source videos through the full download → Deepgram → Cerebras
`gpt-oss-120b` → render loop.

The watcher does **not** pass `--target-pending`, so it will keep producing
whenever it does see a new upload, regardless of how deep the backlog already
is. If the backlog becomes a disk problem, add `--target-pending <n>` to
`agent-watch.ps1` rather than stopping the watcher.

**Why 0 items are in `failed` state** — `src/queue.js` `markFailed()` takes a
`{ retryable }` flag and only increments `item.attempts` when `retryable` is
false; only non-retryable items reaching `attempts >= 5` flip to `failed`.
`src/cli.js` computes `retryable = err.reason === 'uploadLimitExceeded' ||
err.reason === 'quotaExceeded'`. Upload-limit rejections are therefore
retryable, do **not** burn the 5-attempt counter, and stay `pending` for the
next slot. `cli.js` also skips `process.exitCode = 1` for retryable failures,
so a capped day is not reported as a broken run. **This is deliberate — do not
"simplify" it into a plain attempt counter, or the whole queue will age out to
`failed` on any capped day.**

Three pending items carry a `lastError` of the upload-limit message. That is
expected, not a fault.

**Publishing order** — `nextPending()` sorts by `item.priority` descending,
then a tag rank: `unstablesmp` first, `lifesteal`/`lifestealsmp` second,
everything else last, then original queue order. The watcher queues with
`--priority 100`, so freshly-discovered clips jump ahead of the 08-10 backlog.

---

## The important bit: `cfc app` vs `cfc clip`

`cfc clip` was the first attempt and it does NOT use ClipForge — it only borrows
the app's bundled ffmpeg and fonts. `cfc app` is the real CLI: it drives
ClipForge's own engine over CDP, so it gets LR-ASD speaker tracking, vocal
energy scoring, visual scoring, and ClipForge's caption styles. Prefer `app`.

How it works: ClipForge's preload exposes the full IPC surface as
`window.clipforge`. Launch `ClipForge.exe --remote-debugging-port=N` with
`OPENAI_BASE_URL` pointed at the router, connect via CDP, call
`window.clipforge.createProjectFromUrl / analyzeProject / updateClip /
exportClip`. `getApiKey()` falls back to `process.env.OPENAI_API_KEY`, so the
DPAPI-encrypted settings store never has to be touched.

Note: the production posting pipeline (`cfc agent`) uses the **standalone**
path — `download.js` → `transcribe.js` (Deepgram) → `analyze.js` +
`evaluate.js` (Cerebras) → `render.js` — not the CDP driver.

---

## Why the router exists

Transcription → Deepgram `nova-3`; chat/ranking → Cerebras. **Cerebras has no
audio endpoint**, which is the entire reason a local OpenAI-compatible router
exists at all. `config.js` also configures a Groq `openai/gpt-oss-120b` chat
failover for when Cerebras exhausts tokens-per-minute, deliberately the same
model so clip scoring does not silently change character mid-run, plus a
multi-key Deepgram pool (`DEEPGRAM_API_KEYS` or numbered `DEEPGRAM_API_KEY_2/_3`).

---

## Commands (from `cfc --help`)

`doctor`, `app`, `clip`, `agent`, `queue`, `queue add --dir <folder>`,
`post-next`, `publish`, `yt-auth`, `proxy`, `launch`.

`post-next` is what the scheduler runs. `queue add --dir` is how rendered
clips get into the queue manually.

---

## Done

- CLI at `D:\opus\clipforge-cli` — zero npm dependencies (Node 22 builtins).
- Full real-video runs completed many times over. **18 Shorts published** with
  live `youtube.com/shorts/...` URLs recorded in `work/queue.json`.
- Local OpenAI-compatible router: transcription → Deepgram, chat → Cerebras,
  Groq chat failover.
- Automated posting: 10 daily Windows Scheduled Tasks running `post-next`.
- Automated discovery: always-on watcher over 6 channels with an agentic
  generate → evaluate loop (`AGENT_MAX_ITER`, default 2).
- Queue with advisory locking, retryable-aware failure handling, and priority
  ranking.
- `npm test` — 3 suites (`analyze-smoke`, `proxy-smoke`, `render-smoke`).
  Not re-run in this session; last known green.
- yt-dlp installed via pip; URL input wired into `clip` and `agent`.

## Not yet done / open

1. **Channel verification at <https://youtube.com/verify>.** Human-only,
   phone-required. This is the single highest-value action available and
   nothing in code substitutes for it.
2. 15 clips pending with a ~3/day drain rate — roughly 5 days of backlog even
   if the watcher finds nothing new.
3. `agent-watch-2026-08-14.log` shows one cycle aborting mid-run:
   `watcher cycle exited 1073807364; retrying after 120 seconds`
   (that value is `0xC000013A` — Ctrl+C / console-close). Uninvestigated. The
   loop self-recovered on the next cycle.
4. Stray zero-content artifacts in the repo root: `NUL.f251.webm`,
   `NUL.f399.mp4` — a yt-dlp `-o NUL` invocation writing real files on Windows.
   Harmless but untracked junk.
5. `USAGE` in `src/cli.js` still advertises "headless ClipForge driver on Groq +
   Cerebras". Transcription moved to Deepgram; Groq is now only the chat
   failover. Stale help text, not a functional bug.

---

## Gotchas discovered

- **Their shared `.env.txt` has `CEREBRAS_MODEL=llama-3.3-70b`, which is NOT on
  their account.** Live catalog seen previously: `gpt-oss-120b`, `zai-glm-4.7`,
  `gemma-4-31b`; `gpt-oss-120b` is what the agent logs show in use. `.env` here
  leaves `CEREBRAS_MODEL` blank so `resolveCerebrasModel()` picks from the live
  catalog. Other projects reading that shared file may be silently broken.
- Cerebras has no audio endpoint. This is the entire reason the router exists.
- ClipForge has NO CLI. Only test env vars (`CLIPFORGE_SMOKE`,
  `CLIPFORGE_SELECT_VIDEO`, `CLIPFORGE_EXPORT_DIR`) — not a supported interface.
- ffmpeg's `subtitles` filter chokes on Windows drive letters, so `renderClip`
  runs ffmpeg with `cwd` set to the clip work dir and uses relative paths.
  Do not "simplify" that to absolute paths.
- Scheduled task names cannot contain `:` — `Register-ScheduledTask` rejects it
  with a bare "parameter is incorrect" instead of naming the real problem.
  `install-scheduler.ps1` strips the colon from the time to build the name.
- `install-agent-scheduler.ps1` silently falls back to an HKCU `Run` entry when
  task registration needs elevation. If you go looking for a `ClipForge Watch`
  scheduled task and don't find one, check the Run key before concluding the
  watcher isn't installed.
- YouTube quota resets at midnight **US/Pacific**, not local midnight
  (`src/quota.js`). Since June 2026 `videos.insert` has its own bucket at 100
  calls/day, and `quota.js` migrates counters written under the old
  1600-units-per-upload model.
- pip warns about an invalid `~itellm` distribution in
  `AppData\Roaming\Python\Python314\site-packages` — pre-existing broken
  litellm install, unrelated but worth cleaning.

---

## Cross-reference — do not re-enable

A second, unrelated pipeline lives at `D:\yt\youtube-autopilot`. Its scheduled
task **`YouTubeAutopilotPost` was deliberately DISABLED on 2026-08-12 at the
user's request** and is confirmed still `Disabled`. It is not part of this
project. Do not re-enable it without asking.

---

## Paths

- ClipForge (0.6.18 per an earlier session; not re-verified):
  `C:\Users\thaku\AppData\Local\Programs\clipforge`
- ffmpeg: `resources\app.asar.unpacked\node_modules\ffmpeg-static\ffmpeg.exe`
- ffprobe: same tree, `ffprobe-static\bin\win32\x64\ffprobe.exe`
- Fonts: `resources\fonts` (Anton-Regular.ttf, Poppins-Bold.ttf)
- ClipForge settings: `%APPDATA%\clipforge\settings.json`
- Queue: `work\queue.json` · Quota: `work\quota.json` · Seen: `work\seen-videos.json`
- Logs: `work\logs\post-YYYY-MM-DD.log`, `work\logs\agent-watch-YYYY-MM-DD.log`
