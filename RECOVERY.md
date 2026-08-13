# RECOVERY — cfc (ClipForge CLI)

## State as of 2026-08-10

**Built, keys wired, fully verified except one real end-to-end run.**

### The important bit: `cfc app` vs `cfc clip`
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

### Done
- CLI at `D:\opus\clipforge-cli` — zero npm dependencies (Node 22 builtins).
- Commands: `doctor`, `clip <file|url>`, `proxy`, `launch`.
- Local OpenAI-compatible router: transcription → Groq, chat → Cerebras.
- `npm test` green — 3 suites, exit 0. Covers multipart parsing (binary-safe),
  Cerebras param translation, HTTP routing, model-JSON extraction, and a real
  ffmpeg render verified at 1080×1920 with captions confirmed in pixels.
- Keys copied from `C:\Users\thaku\OneDrive\Documents\.env.txt` into `.env`.
  `doctor` confirms both live.
- Cerebras ranking verified live (`node test/live-rank.mjs`) — correctly skipped
  a sponsor read and filler, picked the real hook. Costs a token or two per run,
  so it is deliberately NOT part of `npm test`.
- yt-dlp 2026.07.04 installed via pip; URL input wired into `clip`.

### Not yet done
No full real-video run. Waiting on the user's YouTube link.
Next: `node src/cli.js clip "<url>" --n 5 --dry-run`, then drop `--dry-run`.

### Gotchas discovered
- **Their shared `.env.txt` has `CEREBRAS_MODEL=llama-3.3-70b`, which is NOT on
  their account.** Live catalog: `gpt-oss-120b`, `zai-glm-4.7`, `gemma-4-31b`.
  `.env` here leaves `CEREBRAS_MODEL` blank so `resolveCerebrasModel()` picks
  from the live catalog. Other projects reading that file may be silently
  broken.
- pip warns about an invalid `~itellm` distribution in
  `AppData\Roaming\Python\Python314\site-packages` — pre-existing broken
  litellm install, unrelated but worth cleaning.
- Cerebras has no audio endpoint. This is the entire reason the router exists.
- ClipForge has NO CLI. Only test env vars (`CLIPFORGE_SMOKE`,
  `CLIPFORGE_SELECT_VIDEO`, `CLIPFORGE_EXPORT_DIR`) — not a supported interface.
- ffmpeg's `subtitles` filter chokes on Windows drive letters, so `renderClip`
  runs ffmpeg with `cwd` set to the clip work dir and uses relative paths.
  Do not "simplify" that to absolute paths.

### Paths
- ClipForge 0.6.18: `C:\Users\thaku\AppData\Local\Programs\clipforge`
- ffmpeg: `resources\app.asar.unpacked\node_modules\ffmpeg-static\ffmpeg.exe`
- ffprobe: same tree, `ffprobe-static\bin\win32\x64\ffprobe.exe`
- Fonts: `resources\fonts` (Anton-Regular.ttf, Poppins-Bold.ttf)
- ClipForge settings: `%APPDATA%\clipforge\settings.json`
