import { spawn } from 'node:child_process';
import { paths } from './config.js';

/**
 * Drives the real ClipForge app from the command line.
 *
 * ClipForge ships no CLI, but its main process registers a full IPC surface
 * (project:create, project:analyze, clip:export, ...) and the preload mirrors
 * it onto `window.clipforge`. So we launch the app with Chrome DevTools
 * Protocol enabled and call that bridge directly from the renderer. Every
 * clip therefore comes out of ClipForge's own engine — including the LR-ASD
 * speaker tracking and caption renderer that a reimplementation cannot reach.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findRendererTarget(port, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      // Skip devtools:// and about:blank; the app window is the page target
      // that actually has our contextBridge on it.
      const page = targets.find(
        (t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.startsWith('devtools://')
      );
      if (page) return page;
    } catch (err) {
      lastErr = err;
    }
    await sleep(400);
  }
  throw new Error(`ClipForge did not expose a debuggable window on port ${port}. ${lastErr?.message || ''}`);
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const slot = this.pending.get(msg.id);
      if (!slot) return;
      this.pending.delete(msg.id);
      msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an async expression in the page and return its resolved value. */
  async eval(expression, { timeout = 0 } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeout || undefined,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(d.exception?.description || d.text || 'Renderer evaluation failed');
    }
    return res.result?.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

export async function connect(port) {
  const target = await findRendererTarget(port);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP websocket failed to open')), { once: true });
  });
  const session = new Session(ws);
  await session.send('Runtime.enable');

  // Wait for the contextBridge to exist — the window opens before the
  // renderer bundle has run.
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await session.eval('typeof window.clipforge === "object" && !!window.clipforge')) break;
    await sleep(300);
  }
  if (!(await session.eval('!!window.clipforge'))) {
    throw new Error('window.clipforge never appeared — the app UI failed to load.');
  }
  return session;
}

/** Install progress taps that buffer events for polling. */
export async function installProgressTaps(session) {
  await session.eval(`
    (() => {
      if (window.__cfc) return true;
      window.__cfc = { pipeline: [], export: [], import: [] };
      window.clipforge.onPipelineProgress?.((p) => window.__cfc.pipeline.push(p));
      window.clipforge.onExportProgress?.((p) => window.__cfc.export.push(p));
      window.clipforge.onImportProgress?.((p) => window.__cfc.import.push(p));
      return true;
    })()
  `);
}

/** Drain buffered progress events of one kind. */
export const drain = (session, kind) =>
  session.eval(`(() => { const b = window.__cfc?.${kind} || []; window.__cfc.${kind} = []; return b; })()`);

/**
 * Call a window.clipforge method. Arguments are JSON-embedded, so they must be
 * serialisable — which every method on the bridge expects anyway.
 */
export function call(session, method, args = [], { timeout = 0 } = {}) {
  const payload = JSON.stringify(args);
  return session.eval(`window.clipforge.${method}(...${payload})`, { timeout });
}

export function launchApp({ port, baseUrl, apiKey = 'cfc-router', show = true }) {
  const child = spawn(
    paths.clipforgeExe,
    [`--remote-debugging-port=${port}`, '--remote-allow-origins=*', ...(show ? [] : ['--hidden'])],
    {
      detached: false,
      stdio: 'ignore',
      env: {
        ...process.env,
        OPENAI_BASE_URL: baseUrl,
        OPENAI_API_BASE: baseUrl,
        // getApiKey() prefers the encrypted setting but falls back to this,
        // so we never have to touch the app's DPAPI-encrypted store.
        OPENAI_API_KEY: apiKey,
      },
    }
  );
  return child;
}
