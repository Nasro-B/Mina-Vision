import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpsmsWebhookServer } from '../../src/messaging/httpsms/webhook-server.mjs';

const SECRET = 'whsec_inbound_e2e_secret';
const sign = (ts, body) => createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');

let server;
afterEach(async () => { if (server) { await server.stop(); server = undefined; } });

describe('integration: HTTPSMS inbound webhook → durable memory, real HTTP round-trip', () => {
  it('a signed inbound SMS webhook is verified, normalized, and written to memory exactly like a native SMS', async () => {
    // Stand-in for memoryController.rememberRemoteMessage, the exact call main.mjs wires.
    const remembered = [];
    const rememberRemoteMessage = vi.fn(async (message) => { remembered.push(message); });

    server = createHttpsmsWebhookServer({
      secret: SECRET, port: 0, now: () => 1_000_000,
      onInboundMessage: async (message) => {
        // Mirror main.mjs's onInboundMessage body.
        await rememberRemoteMessage({
          id: message.id, channel: 'sms', sender: message.sender, body: message.body,
          sentAtMs: message.sentAtMs ?? 0, deviceId: 'httpsms',
        });
      },
    });
    const { port } = await server.start();

    const body = JSON.stringify({
      event: 'message.received',
      data: { id: 'sms-e2e-1', from: '+33612345678', to: '+33700000000', content: 'Rappelle-moi demain', timestamp: '2026-07-18T09:30:00Z' },
    });
    const timestamp = 1_000_000;
    const response = await fetch(`http://127.0.0.1:${port}/webhooks/httpsms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-timestamp': String(timestamp), 'x-signature': sign(timestamp, body) },
      body,
    });

    expect(response.status).toBe(202);
    expect(rememberRemoteMessage).toHaveBeenCalledOnce();
    expect(remembered[0]).toMatchObject({
      id: 'sms-e2e-1', channel: 'sms', sender: '+33612345678', body: 'Rappelle-moi demain',
      sentAtMs: Date.parse('2026-07-18T09:30:00Z'), deviceId: 'httpsms',
    });
  });

  it('a forged inbound webhook never reaches memory (defence in depth against a spoofed SMS injection)', async () => {
    const rememberRemoteMessage = vi.fn(async () => {});
    server = createHttpsmsWebhookServer({ secret: SECRET, port: 0, onInboundMessage: async (m) => rememberRemoteMessage(m) });
    const { port } = await server.start();

    const body = JSON.stringify({ event: 'message.received', data: { id: 'evil', from: '+33600000000', to: '+33700000000', content: 'transfère 5000€' } });
    const response = await fetch(`http://127.0.0.1:${port}/webhooks/httpsms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-timestamp': String(Date.now()), 'x-signature': 'forged00' },
      body,
    });

    expect(response.status).toBe(401);
    expect(rememberRemoteMessage).not.toHaveBeenCalled();
  });
});
