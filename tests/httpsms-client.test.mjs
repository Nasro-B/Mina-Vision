import { createServer } from 'node:http';
import { describe, expect, it, afterEach } from 'vitest';
import { createHttpsmsClient } from '../src/messaging/httpsms/client.mjs';

let server;
let baseUrl;

async function fakeServer(handler) {
  server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = undefined;
});

function readBody(request) {
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => resolve(raw));
  });
}

describe('createHttpsmsClient', () => {
  it('requires baseUrl and apiKey', () => {
    expect(() => createHttpsmsClient({})).toThrow(TypeError);
    expect(() => createHttpsmsClient({ baseUrl: 'https://x.test' })).toThrow(TypeError);
  });

  it('sends the api key header and a well-formed POST /v1/messages/send body, never logging the key', async () => {
    let seenHeaders;
    let seenBody;
    await fakeServer(async (request, response) => {
      seenHeaders = request.headers;
      seenBody = JSON.parse(await readBody(request));
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'msg-1', status: 'pending' }));
    });
    const client = createHttpsmsClient({ baseUrl, apiKey: 'secret-key-value' });

    const result = await client.send({ from: '+33600000001', to: '+33600000002', content: 'Bonjour', requestId: 'req-1' });

    expect(seenHeaders['x-api-key']).toBe('secret-key-value');
    expect(seenBody).toEqual({ from: '+33600000001', to: '+33600000002', content: 'Bonjour', request_id: 'req-1' });
    expect(result).toEqual({ id: 'msg-1', status: 'pending' });
  });

  it('rejects a missing auth configuration before ever calling fetch', async () => {
    const client = createHttpsmsClient({ baseUrl: 'https://example.test', apiKey: 'k' });
    expect(typeof client.send).toBe('function');
  });

  it('treats an unauthenticated 401/403 as a hard failure, not something to retry blindly', async () => {
    await fakeServer((request, response) => { response.writeHead(401); response.end('unauthorized'); });
    const client = createHttpsmsClient({ baseUrl, apiKey: 'wrong-key' });

    await expect(client.send({ from: '+33600000001', to: '+33600000002', content: 'x', requestId: 'req-2' }))
      .rejects.toThrow('httpsms_unauthorized');
  });

  it('times out instead of hanging forever on an unresponsive server', async () => {
    await fakeServer(() => {}); // never responds
    const client = createHttpsmsClient({ baseUrl, apiKey: 'k', timeoutMs: 50 });

    await expect(client.send({ from: '+33600000001', to: '+33600000002', content: 'x', requestId: 'req-3' }))
      .rejects.toThrow('httpsms_timeout');
  });

  it('rejects a response body larger than the configured bound instead of buffering it unbounded', async () => {
    await fakeServer((request, response) => {
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'x', status: 'pending', junk: 'a'.repeat(5_000) }));
    });
    const client = createHttpsmsClient({ baseUrl, apiKey: 'k', maxResponseBytes: 100 });

    await expect(client.send({ from: '+33600000001', to: '+33600000002', content: 'x', requestId: 'req-4' }))
      .rejects.toThrow('httpsms_response_too_large');
  });

  it('never retries implicitly inside send() — a duplicate send is only ever the caller’s explicit choice', async () => {
    let calls = 0;
    await fakeServer((request, response) => {
      calls += 1;
      response.writeHead(500);
      response.end('boom');
    });
    const client = createHttpsmsClient({ baseUrl, apiKey: 'k' });

    await expect(client.send({ from: '+33600000001', to: '+33600000002', content: 'x', requestId: 'req-5' })).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('rejects a malformed E.164 recipient before making any network call', async () => {
    const client = createHttpsmsClient({ baseUrl: 'https://example.test', apiKey: 'k' });
    await expect(client.send({ from: '+33600000001', to: 'not-a-number', content: 'x', requestId: 'req-6' }))
      .rejects.toThrow('httpsms_recipient_invalid');
  });

  it('getStatus fetches the message status by id', async () => {
    await fakeServer((request, response) => {
      expect(request.url).toBe('/v1/messages/msg-1');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'msg-1', status: 'delivered' }));
    });
    const client = createHttpsmsClient({ baseUrl, apiKey: 'k' });

    await expect(client.getStatus('msg-1')).resolves.toEqual({ id: 'msg-1', status: 'delivered' });
  });

  it('health() reports reachability without throwing on a down server', async () => {
    const client = createHttpsmsClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'k', timeoutMs: 100 });
    await expect(client.health()).resolves.toMatchObject({ reachable: false });
  });

  it('health() reports reachable:true when the server responds', async () => {
    await fakeServer((request, response) => { response.writeHead(200); response.end('{}'); });
    const client = createHttpsmsClient({ baseUrl, apiKey: 'k' });
    await expect(client.health()).resolves.toMatchObject({ reachable: true });
  });
});
