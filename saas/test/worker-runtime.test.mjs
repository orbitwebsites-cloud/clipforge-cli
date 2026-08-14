import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Linux worker uses python3 and refuses to lease jobs without yt-dlp', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile.worker', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../worker/clip-worker.mjs', import.meta.url), 'utf8');
  const download = readFileSync(new URL('../../src/download.js', import.meta.url), 'utf8');
  const discover = readFileSync(new URL('../../src/discover.js', import.meta.url), 'utf8');

  assert.match(dockerfile, /CFC_PYTHON=\/usr\/bin\/python3/);
  assert.match(dockerfile, /python3 -m yt_dlp --version/);
  assert.match(download, /process\.platform === 'win32' \? 'python' : 'python3'/);
  assert.match(discover, /process\.platform === 'win32' \? 'python' : 'python3'/);
  assert.match(worker, /await ytdlpVersion\(\)/);
  assert.match(worker, /Worker startup failed: yt-dlp is unavailable/);
  assert.match(worker, /Worker media runtime ready/);
});
