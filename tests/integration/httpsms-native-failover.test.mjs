import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpsmsClient } from '../../src/messaging/httpsms/client.mjs';
import { createHttpsmsProvider } from '../../src/messaging/httpsms/provider.mjs';
import { createSmsRouter } from '../../src/messaging/sms-router.mjs';
import { createMessageDeliveryLedger } from '../../src/messaging/message-delivery-ledger.mjs';

function readBody(request) {
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => resolve(raw));
  });
}

let server;
afterEach(async () => { if (server) { await new Promise((resolve) => server.close(resolve)); server = undefined; } });

async function realHttpsmsProvider(handler) {
  server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = createHttpsmsClient({ baseUrl, apiKey: 'integration-test-key' });
  return createHttpsmsProvider({ client });
}

describe('integration: HTTPSMS ↔ native SMS failover, real HTTP server + real SQLite ledger on disk', () => {
  it('a genuinely offline native device fails over to a real httpSMS HTTP call, exactly once', async () => {
    const sendCalls = [];
    const httpsms = await realHttpsmsProvider(async (request, response) => {
      sendCalls.push(JSON.parse(await readBody(request)));
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'httpsms-msg-1', status: 'pending' }));
    });
    const native = { id: 'native', send: vi.fn(async () => { throw new Error('device offline'); }) };

    const directory = await mkdtemp(join(tmpdir(), 'mina-sms-router-'));
    try {
      const ledger = createMessageDeliveryLedger({ filename: join(directory, 'sms.sqlite') });
      const router = createSmsRouter({ nativeProvider: native, httpsmsProvider: httpsms, mode: 'native-first', ledger });

      const result = await router.send({ requestId: 'integration-req-1', from: '+33600000001', to: '+33600000002', content: 'Panne native, bascule réelle.' });

      expect(result.providerId).toBe('httpsms');
      expect(native.send).toHaveBeenCalledOnce();
      expect(sendCalls).toEqual([{ from: '+33600000001', to: '+33600000002', content: 'Panne native, bascule réelle.', request_id: 'integration-req-1' }]);
      ledger.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('survives a restart mid-failover: the reconciled ledger on disk prevents a duplicate httpSMS send', async () => {
    const sendCalls = [];
    const httpsms = await realHttpsmsProvider(async (request, response) => {
      sendCalls.push(await readBody(request));
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'httpsms-msg-2', status: 'pending' }));
    });
    const native = { id: 'native', send: vi.fn(async () => { throw new Error('device offline'); }) };
    const directory = await mkdtemp(join(tmpdir(), 'mina-sms-router-'));
    try {
      const filename = join(directory, 'sms.sqlite');
      const firstProcess = createMessageDeliveryLedger({ filename });
      const firstRouter = createSmsRouter({ nativeProvider: native, httpsmsProvider: httpsms, mode: 'native-first', ledger: firstProcess });
      await firstRouter.send({ requestId: 'integration-req-2', from: '+33600000001', to: '+33600000002', content: 'Avant redémarrage' });
      firstProcess.close();

      // Simulated app restart: a brand-new ledger instance backed by the SAME file.
      const secondProcess = createMessageDeliveryLedger({ filename });
      const secondRouter = createSmsRouter({ nativeProvider: native, httpsmsProvider: httpsms, mode: 'native-first', ledger: secondProcess });
      const resumed = await secondRouter.send({ requestId: 'integration-req-2', from: '+33600000001', to: '+33600000002', content: 'Avant redémarrage' });

      expect(resumed.providerMessageId).toBe('httpsms-msg-2');
      expect(sendCalls).toHaveLength(1); // never sent twice across the restart
      secondProcess.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('an unauthorized httpSMS API key surfaces cleanly and native-only mode never even tries it', async () => {
    server = createServer((request, response) => { response.writeHead(401); response.end('unauthorized'); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const httpsms = createHttpsmsProvider({ client: createHttpsmsClient({ baseUrl, apiKey: 'wrong-key' }) });
    const native = { id: 'native', send: vi.fn(async () => { throw new Error('device offline'); }) };
    const ledger = createMessageDeliveryLedger({ filename: ':memory:' });

    const router = createSmsRouter({ nativeProvider: native, httpsmsProvider: httpsms, mode: 'native-first', ledger });
    await expect(router.send({ requestId: 'integration-req-3', from: '+33600000001', to: '+33600000002', content: 'x' }))
      .rejects.toThrow(/httpsms_unauthorized/u);

    const nativeOnlyRouter = createSmsRouter({ nativeProvider: native, httpsmsProvider: httpsms, mode: 'native-only', ledger: createMessageDeliveryLedger({ filename: ':memory:' }) });
    await expect(nativeOnlyRouter.send({ requestId: 'integration-req-4', from: '+33600000001', to: '+33600000002', content: 'x' })).rejects.toThrow();
  });
});
