import { createServer } from 'node:http';
import { createHttpsmsWebhookVerifier } from './webhook-verifier.mjs';
import { normalizeInboundWebhook } from './contracts.mjs';

// Local HTTP endpoint that receives httpSMS inbound-SMS webhooks. Every request is
// signature-verified (HMAC over `${timestamp}.${rawBody}`, replay-guarded) BEFORE its body is
// parsed or acted on — an unauthenticated request never reaches onInboundMessage. Clean-room
// design: this is the receiving counterpart to client.mjs (sending), never derived from the AGPL
// httpsms service source.
export function createHttpsmsWebhookServer({
  secret,
  onInboundMessage,
  host = '127.0.0.1',
  port = 0,
  path = '/webhooks/httpsms',
  now = () => Date.now(),
  toleranceMs,
  maxBodyBytes = 256 * 1_024,
} = {}) {
  if (typeof onInboundMessage !== 'function') throw new TypeError('httpsms_webhook_server_callback_required');
  const verifier = createHttpsmsWebhookVerifier({ secret, now, maxBodyBytes, ...(toleranceMs ? { toleranceMs } : {}) });
  let server = null;

  const readBody = (request) => new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      // Stop ACCUMULATING past the bound (memory protection) but keep draining the socket so a
      // clean 413 can still be written — destroying the socket mid-upload would deny the client
      // any response and surface as a raw connection error instead.
      if (bytes > maxBodyBytes) { tooLarge = true; raw = ''; return; }
      raw += chunk;
    });
    request.on('end', () => (tooLarge ? reject(new Error('httpsms_webhook_body_too_large')) : resolve(raw)));
    request.on('error', reject);
  });

  const handle = async (request, response) => {
    if (request.url?.split('?')[0] !== path) { response.writeHead(404).end(); return; }
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }

    let rawBody;
    try {
      rawBody = await readBody(request);
    } catch {
      response.writeHead(413).end();
      return;
    }

    let payload;
    try {
      payload = verifier.verifyAndParse({
        rawBody,
        timestamp: Number(request.headers['x-timestamp']),
        signature: request.headers['x-signature'],
      });
    } catch {
      // Any verification failure (bad signature, stale, replay, malformed) is a flat 401 — never
      // leak which check failed, and never touch onInboundMessage.
      response.writeHead(401).end();
      return;
    }

    let message;
    try {
      message = normalizeInboundWebhook(payload);
    } catch {
      response.writeHead(400).end();
      return;
    }

    // Authentic request accepted (202) even for a delivery-status event (message === null) or a
    // downstream failure: httpSMS only needs to know the webhook itself is healthy, so it never
    // retry-storms. A real memory-write failure is handled internally, not by rejecting httpSMS.
    if (message) {
      try {
        await onInboundMessage(message);
      } catch { /* swallowed on purpose — see comment above */ }
    }
    response.writeHead(202).end();
  };

  return Object.freeze({
    start: () => new Promise((resolve, reject) => {
      server = createServer((request, response) => { void handle(request, response); });
      server.once('error', reject);
      server.listen(port, host, () => resolve({ port: server.address().port, host }));
    }),
    stop: () => new Promise((resolve) => {
      if (!server) { resolve(); return; }
      const current = server;
      server = null;
      current.close(() => resolve());
    }),
  });
}
