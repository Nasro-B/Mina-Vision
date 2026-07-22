import { createServer } from 'node:http';

const SUCCESS_BODY = `<!doctype html><html><head><meta charset="utf-8"><title>Mina Vision</title></head>
<body style="font-family:sans-serif;text-align:center;padding-top:3rem">
<h1>Mina Vision</h1><p>Compte connecte. Vous pouvez fermer cet onglet et revenir a la console.</p>
</body></html>`;

// A local-only, loopback (127.0.0.1) HTTP server that exists for the few seconds of a single OAuth
// consent round-trip. Never bound to a non-loopback interface, never left running once stop() is
// called — this is the desktop "installed app" redirect pattern Google's own OAuth flow expects,
// not a general-purpose web server.
export function createOAuthLoopbackServer({ expectedState, timeoutMs = 120_000 } = {}) {
  if (typeof expectedState !== 'string' || expectedState.length === 0) {
    throw new TypeError('oauth_loopback_state_required');
  }
  let server = null;
  let resolveCode = null;
  let rejectCode = null;
  let timeoutHandle = null;
  const pending = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // Node flags `pending` as an unhandled rejection if it rejects before the caller's own
  // `await waitForCode()` line runs (a real race: the HTTP response can complete, and the promise
  // reject synchronously inside it, before the test/caller's next line attaches a handler). This
  // silenced clone marks the promise as handled from Node's perspective without ever swallowing the
  // rejection for the real caller — `waitForCode()` still returns the original `pending` untouched.
  pending.catch(() => {});
  let settled = false;

  function settle(fn, value) {
    if (settled) return;
    settled = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    fn(value);
  }

  return Object.freeze({
    async start() {
      server = createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (url.pathname !== '/oauth/callback') {
          response.writeHead(404).end('not_found');
          return;
        }
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        if (error) {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(SUCCESS_BODY);
          settle(rejectCode, new Error(`oauth_loopback_denied:${error}`));
          return;
        }
        if (state !== expectedState) {
          response.writeHead(400).end('state_mismatch');
          settle(rejectCode, new Error('oauth_loopback_state_mismatch'));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(SUCCESS_BODY);
        settle(resolveCode, Object.freeze({ code, state }));
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      timeoutHandle = setTimeout(() => settle(rejectCode, new Error('oauth_loopback_timeout')), timeoutMs);
      timeoutHandle.unref?.();
      return Object.freeze({ port: server.address().port });
    },

    waitForCode() {
      return pending;
    },

    async stop() {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (!server) return undefined;
      await new Promise((resolve) => server.close(() => resolve(undefined)));
      server = null;
      return undefined;
    },
  });
}
