import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpsmsWebhookServer } from '../src/messaging/httpsms/webhook-server.mjs';

const SECRET = 'whsec_integration_secret';

function sign(timestamp, rawBody) {
  return createHmac('sha256', SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
}

let server;
afterEach(async () => { if (server) { await server.stop(); server = undefined; } });

async function startServer(overrides = {}) {
  const onInboundMessage = overrides.onInboundMessage ?? vi.fn(async () => {});
  server = createHttpsmsWebhookServer({
    secret: SECRET, host: '127.0.0.1', port: 0, onInboundMessage,
    now: overrides.now ?? (() => 1_000_000),
    path: overrides.path ?? '/webhooks/httpsms',
    // F-06 : file durable et rapport d'échec, absents par défaut (comportement historique).
    ...(overrides.persistInbound ? { persistInbound: overrides.persistInbound } : {}),
    ...(overrides.onProcessingError ? { onProcessingError: overrides.onProcessingError } : {}),
  });
  const { port } = await server.start();
  return { onInboundMessage, port };
}

async function post(port, { rawBody, timestamp = 1_000_000, signature, path = '/webhooks/httpsms', method = 'POST' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (signature !== null) headers['x-signature'] = signature ?? sign(timestamp, rawBody);
  if (timestamp !== null) headers['x-timestamp'] = String(timestamp);
  return fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: rawBody });
}

const inboundBody = JSON.stringify({
  event: 'message.received',
  data: { id: 'sms-in-1', from: '+33600000009', to: '+33700000000', content: 'Bonjour Mina', timestamp: '2026-07-18T10:00:00Z' },
});

describe('createHttpsmsWebhookServer', () => {
  it('requires a secret and an onInboundMessage callback', () => {
    expect(() => createHttpsmsWebhookServer({ onInboundMessage: () => {} })).toThrow(TypeError);
    expect(() => createHttpsmsWebhookServer({ secret: 'whsec_xxxxxxxx' })).toThrow(TypeError);
  });

  it('accepts a correctly signed inbound SMS webhook and forwards a normalized message', async () => {
    const { onInboundMessage, port } = await startServer();

    const response = await post(port, { rawBody: inboundBody });

    expect(response.status).toBe(202);
    expect(onInboundMessage).toHaveBeenCalledWith({
      channel: 'sms', providerId: 'httpsms', id: 'sms-in-1',
      sender: '+33600000009', recipient: '+33700000000', body: 'Bonjour Mina',
      sentAtMs: Date.parse('2026-07-18T10:00:00Z'),
    });
  });

  it('rejects a forged signature with 401 and never invokes the callback', async () => {
    const { onInboundMessage, port } = await startServer();

    const response = await post(port, { rawBody: inboundBody, signature: 'deadbeef' });

    expect(response.status).toBe(401);
    expect(onInboundMessage).not.toHaveBeenCalled();
  });

  it('rejects a replayed webhook (same signature twice) with 401 on the second call', async () => {
    const { onInboundMessage, port } = await startServer();

    expect((await post(port, { rawBody: inboundBody })).status).toBe(202);
    expect((await post(port, { rawBody: inboundBody })).status).toBe(401);
    expect(onInboundMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale timestamp outside the tolerance window', async () => {
    const { onInboundMessage, port } = await startServer({ now: () => 1_000_000 });

    const response = await post(port, { rawBody: inboundBody, timestamp: 1_000_000 - 10 * 60_000 });

    expect(response.status).toBe(401);
    expect(onInboundMessage).not.toHaveBeenCalled();
  });

  it('returns 404 for a path other than the configured webhook path', async () => {
    const { port } = await startServer();
    expect((await post(port, { rawBody: inboundBody, path: '/other' })).status).toBe(404);
  });

  it('returns 405 for a non-POST method on the webhook path', async () => {
    const { port } = await startServer();
    const response = await fetch(`http://127.0.0.1:${port}/webhooks/httpsms`, { method: 'GET' });
    expect(response.status).toBe(405);
  });

  it('rejects a body larger than the bound with 413, protecting memory', async () => {
    const { onInboundMessage, port } = await startServer();
    const huge = 'a'.repeat(300 * 1024);
    const body = JSON.stringify({ event: 'message.received', data: { id: 'x', from: '+33600000009', to: '+33700000000', content: huge } });

    const response = await post(port, { rawBody: body });

    expect([401, 413]).toContain(response.status);
    expect(onInboundMessage).not.toHaveBeenCalled();
  });

  it('ignores a non-message event (e.g. delivery status) with 202 but no inbound forward', async () => {
    const { onInboundMessage, port } = await startServer();
    const statusBody = JSON.stringify({ event: 'message.sent', data: { id: 'sms-out-1', status: 'delivered' } });

    const response = await post(port, { rawBody: statusBody });

    expect(response.status).toBe(202);
    expect(onInboundMessage).not.toHaveBeenCalled();
  });

  it('returns 500-safe (still 202 to httpSMS) when the callback throws, so httpSMS does not retry-storm', async () => {
    const onInboundMessage = vi.fn(async () => { throw new Error('memory_write_failed'); });
    const { port } = await startServer({ onInboundMessage });

    const response = await post(port, { rawBody: inboundBody });

    // The message was authentic; a downstream failure must not make httpSMS think the webhook is
    // broken and hammer it — we accept it and handle the failure internally.
    expect(response.status).toBe(202);
    expect(onInboundMessage).toHaveBeenCalledOnce();
  });

  // Finding F-06 (audit 2026-07-27) : l'échec du callback était avalé par un `catch` vide, puis
  // acquitté 202. Aucune file durable, aucun retry, aucun log : le fournisseur croyait le message
  // accepté alors que Mina ne l'avait pas mémorisé — perte silencieuse.
  it('F-06 — un échec de traitement est SIGNALÉ (plus jamais avalé en silence)', async () => {
    const onInboundMessage = vi.fn(async () => { throw new Error('memory_write_failed'); });
    const onProcessingError = vi.fn();
    const { port } = await startServer({ onInboundMessage, onProcessingError });

    const response = await post(port, { rawBody: inboundBody });

    expect(response.status).toBe(202); // toujours pas de retry-storm
    expect(onProcessingError).toHaveBeenCalledOnce();
    const [report] = onProcessingError.mock.calls[0];
    expect(report.error).toContain('memory_write_failed');
    expect(report.messageId).toBe('sms-in-1');
    expect(report.persisted).toBe(false); // aucune file durable configurée : c'est dit franchement
  });

  it('F-06 — la file durable reçoit le message AVANT le traitement, et l\'échec y reste rejouable', async () => {
    const order = [];
    const persistInbound = vi.fn(async () => { order.push('persist'); });
    const onInboundMessage = vi.fn(async () => { order.push('process'); throw new Error('memory_write_failed'); });
    const onProcessingError = vi.fn();
    const { port } = await startServer({ persistInbound, onInboundMessage, onProcessingError });

    const response = await post(port, { rawBody: inboundBody });

    expect(order).toEqual(['persist', 'process']); // durable d'abord, traitement ensuite
    expect(response.status).toBe(202);
    expect(onProcessingError.mock.calls[0][0].persisted).toBe(true); // rejouable depuis la file
  });

  it('F-06 — si la file durable elle-même échoue, on N\'acquitte PAS (httpSMS doit réessayer)', async () => {
    const persistInbound = vi.fn(async () => { throw new Error('inbox_write_failed'); });
    const onInboundMessage = vi.fn();
    const { port } = await startServer({ persistInbound, onInboundMessage });

    const response = await post(port, { rawBody: inboundBody });

    // Acquitter 202 sans rien avoir gardé serait un mensonge : le message serait perdu.
    expect(response.status).toBe(503);
    expect(onInboundMessage).not.toHaveBeenCalled();
  });

  it('start() returns the actually-bound port and stop() closes cleanly (idempotent)', async () => {
    const { port } = await startServer();
    expect(port).toBeGreaterThan(0);
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined(); // idempotent
    server = undefined;
  });
});
