import http from 'node:http';
import { readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './config.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];
export const SCOPE = SCOPES.join(' ');

export const creds = () => ({
  clientId: process.env.YOUTUBE_CLIENT_ID || '',
  clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
  refreshToken: process.env.YOUTUBE_REFRESH_TOKEN || '',
});

/** Exchange the stored refresh token for a short-lived access token. */
export async function accessToken(credentials = creds()) {
  const { clientId, clientSecret, refreshToken } = credentials;
  if (!clientId || !clientSecret) throw new Error('YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET missing from .env');
  if (!refreshToken) throw new Error('YOUTUBE_REFRESH_TOKEN missing — run: node src/cli.js yt-auth');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    const hint =
      body.error === 'invalid_grant'
        ? '\n  The refresh token is expired or revoked. Google expires these after 7 days while the' +
          '\n  OAuth consent screen is in "Testing". Set it to "In production", then re-run:' +
          '\n    node src/cli.js yt-auth'
        : '';
    throw new Error(`Token refresh failed (${res.status}): ${body.error_description || body.error}${hint}`);
  }
  return body.access_token;
}

/**
 * One-time browser consent to mint a refresh token. Runs a loopback server and
 * waits for Google to redirect back with a code. The user consents in their own
 * browser — nothing here ever sees their password.
 */
export function authorize({ port = 8788, log = () => {} } = {}) {
  const { clientId, clientSecret } = creds();
  if (!clientId || !clientSecret) throw new Error('YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET missing from .env');
  const redirectUri = `http://localhost:${port}`;

  const url =
    `${AUTH_URL}?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      include_granted_scopes: 'true',
      // Required to get a refresh token back rather than only an access token.
      access_type: 'offline',
      prompt: 'consent',
    });

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const q = new URL(req.url, redirectUri).searchParams;
      const code = q.get('code');
      const err = q.get('error');
      const reply = (msg) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body style="font-family:system-ui;padding:3rem"><h2>${msg}</h2>
          <p>You can close this tab and return to the terminal.</p></body></html>`);
      };
      if (err) {
        reply(`Authorization denied: ${err}`);
        server.close();
        return reject(new Error(`Authorization denied: ${err}`));
      }
      if (!code) return reply('Waiting for the authorization code…');

      try {
        const r = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error_description || body.error || `HTTP ${r.status}`);
        if (!body.refresh_token) {
          throw new Error('Google returned no refresh_token. Revoke this app at myaccount.google.com/permissions and retry.');
        }
        reply('Authorized. Refresh token saved.');
        server.close();
        resolve(body.refresh_token);
      } catch (e) {
        reply(`Token exchange failed: ${e.message}`);
        server.close();
        reject(e);
      }
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      log(`\nOpen this URL in your browser and approve access:\n\n${url}\n`);
      log(`Listening on ${redirectUri} for the redirect…`);
      log(`(If Google rejects the redirect, add "${redirectUri}" as an authorised redirect URI`);
      log(` for this OAuth client in the Google Cloud console.)\n`);
      // This consent screen is intentionally visible: the channel owner must
      // review and approve the requested read-only analytics permissions.
      const opener = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
        detached: true,
        stdio: 'ignore',
      });
      opener.unref();
    });
  });
}

/** Persist a new refresh token into the local .env, preserving other keys. */
export function saveRefreshToken(token) {
  const file = path.join(ROOT, '.env');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const idx = lines.findIndex((l) => l.trim().startsWith('YOUTUBE_REFRESH_TOKEN='));
  const entry = `YOUTUBE_REFRESH_TOKEN=${token}`;
  if (idx === -1) lines.push(entry);
  else lines[idx] = entry;
  writeFileSync(file, lines.filter((l, i) => l !== '' || i < lines.length - 1).join('\n').trimEnd() + '\n');
  return file;
}

/**
 * Resumable upload of one video.
 *
 * NOTE ON PRIVACY: unverified OAuth clients cannot publish public videos —
 * YouTube forces uploads from unaudited projects to private regardless of what
 * is requested here. Treat `privacyStatus: 'public'` as a request, not a
 * guarantee, and check the response.
 */
function finalizeResult(result) {
  return {
    id: result.id,
    url: `https://youtube.com/watch?v=${result.id}`,
    shortUrl: `https://youtube.com/shorts/${result.id}`,
    privacyStatus: result.status?.privacyStatus,
    title: result.snippet?.title,
  };
}

/** Query how many bytes YouTube has already received for a resumable session. */
async function resumeOffset(location, size) {
  const res = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes */${size}` },
  });
  if (res.status === 308) {
    const range = res.headers.get('range'); // e.g. "bytes=0-12345"
    return range ? Number(range.split('-')[1]) + 1 : 0;
  }
  if (res.ok) {
    // Already fully received and processed on a prior attempt.
    const result = await res.json().catch(() => ({}));
    return { done: true, result };
  }
  return null; // session expired/invalid — caller must start a fresh one
}

export async function uploadVideo(file, meta, { log = () => {}, token: suppliedToken = null, credentials = null, resumeLocation = null } = {}) {
  if (!existsSync(file)) throw new Error(`No such file: ${file}`);
  const size = statSync(file).size;
  const token = suppliedToken || await accessToken(credentials || creds());

  let location = resumeLocation;
  let startByte = 0;

  if (location) {
    const offset = await resumeOffset(location, size);
    if (offset && typeof offset === 'object' && offset.done) {
      return finalizeResult(offset.result);
    }
    if (offset === null) location = null; // expired — fall through to a fresh session
    else startByte = offset;
  }

  if (!location) {
    const body = {
      snippet: {
        title: (meta.title || path.basename(file)).slice(0, 100),
        description: (meta.description || '').slice(0, 5000),
        tags: meta.tags || undefined,
        categoryId: meta.categoryId || '22',
      },
      status: {
        privacyStatus: meta.privacyStatus || 'private',
        selfDeclaredMadeForKids: Boolean(meta.madeForKids),
      },
    };

    const init = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(body),
    });
    if (!init.ok) {
      const text = await init.text();
      let reason = '';
      try {
        reason = JSON.parse(text).error?.errors?.[0]?.reason || '';
      } catch {
        /* non-JSON body */
      }
      // Two different ceilings get confused constantly:
      //   quotaExceeded      -> the project's 10,000 API units/day (~6 inserts)
      //   uploadLimitExceeded-> a per-channel cap YouTube puts on unverified or
      //                         new channels. Usually tighter, and no amount of
      //                         API quota buys past it.
      const err = new Error(
        reason === 'uploadLimitExceeded'
          ? 'Channel upload limit reached — YouTube caps uploads per channel per day, separately from API quota. ' +
            'Verify the channel at youtube.com/verify to raise it, or wait ~24h.'
          : reason === 'quotaExceeded'
            ? 'API quota exhausted: videos.insert costs 1600 of 10000 units/day (~6 uploads).'
            : `Upload init failed (${init.status})\n${text.slice(0, 400)}`
      );
      err.reason = reason;
      throw err;
    }
    location = init.headers.get('location');
    if (!location) throw new Error('No resumable upload URL returned by YouTube');
  }

  const remaining = size - startByte;
  log(startByte ? `  resuming upload at ${(startByte / 1048576).toFixed(1)}/${(size / 1048576).toFixed(1)} MB…` : `  uploading ${(size / 1048576).toFixed(1)} MB…`);
  const ctrl = new AbortController();
  // A stalled connection with no timeout hangs the upload stage forever —
  // the job's lease eventually expires and gets stolen, so this looks
  // identical to the "stuck processing" symptom the lease-TTL fix addressed.
  const timer = setTimeout(() => ctrl.abort(), 20 * 60_000);
  let put;
  try {
    const buf = readFileSync(file);
    put = await fetch(location, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(remaining),
        ...(startByte ? { 'Content-Range': `bytes ${startByte}-${size - 1}/${size}` } : {}),
      },
      body: startByte ? buf.subarray(startByte) : buf,
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Upload timed out after 20 minutes — stalled connection to YouTube.');
      timeoutErr.location = location;
      throw timeoutErr;
    }
    err.location = location;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const result = await put.json().catch(() => ({}));
  if (!put.ok) {
    const err = new Error(`Upload failed (${put.status}): ${JSON.stringify(result).slice(0, 500)}`);
    err.location = location;
    throw err;
  }

  return finalizeResult(result);
}
