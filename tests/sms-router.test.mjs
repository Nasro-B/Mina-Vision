import { describe, expect, it, vi } from 'vitest';
import { createSmsRouter } from '../src/messaging/sms-router.mjs';
import { createMessageDeliveryLedger } from '../src/messaging/message-delivery-ledger.mjs';

function providerFake(id, { accepted = true, throws } = {}) {
  return {
    id,
    send: vi.fn(async () => {
      if (throws) throw throws;
      return { providerId: id, accepted, providerMessageId: `${id}-msg`, state: accepted ? 'sent' : 'rejected' };
    }),
  };
}

function harness(overrides = {}) {
  const native = overrides.native ?? providerFake('native');
  const httpsms = overrides.httpsms ?? providerFake('httpsms');
  const ledger = overrides.ledger ?? createMessageDeliveryLedger({ filename: ':memory:' });
  return {
    native, httpsms, ledger,
    router: createSmsRouter({ nativeProvider: native, httpsmsProvider: httpsms, mode: overrides.mode ?? 'native-first', ledger }),
  };
}

const request = { requestId: 'req-1', from: '+33600000001', to: '+33600000002', content: 'Bonjour' };

describe('createSmsRouter', () => {
  it('rejects an unknown mode', () => {
    expect(() => createSmsRouter({ mode: 'bogus', ledger: createMessageDeliveryLedger({ filename: ':memory:' }) })).toThrow(TypeError);
  });

  it('native-first: uses native only when it succeeds', async () => {
    const { native, httpsms, router } = harness({ mode: 'native-first' });

    const result = await router.send(request);

    expect(result.providerId).toBe('native');
    expect(native.send).toHaveBeenCalledOnce();
    expect(httpsms.send).not.toHaveBeenCalled();
  });

  it('native-first: falls back to httpsms only when native does not accept', async () => {
    const { native, httpsms, router } = harness({ mode: 'native-first', native: providerFake('native', { accepted: false }) });

    const result = await router.send(request);

    expect(result.providerId).toBe('httpsms');
    expect(native.send).toHaveBeenCalledOnce();
    expect(httpsms.send).toHaveBeenCalledOnce();
  });

  it('native-first: falls back to httpsms when native throws (network down)', async () => {
    const { httpsms, router } = harness({ mode: 'native-first', native: providerFake('native', { throws: new Error('device offline') }) });

    const result = await router.send(request);

    expect(result.providerId).toBe('httpsms');
    expect(httpsms.send).toHaveBeenCalledOnce();
  });

  it('httpsms-first: tries httpsms before native', async () => {
    const { native, httpsms, router } = harness({ mode: 'httpsms-first' });

    const result = await router.send(request);

    expect(result.providerId).toBe('httpsms');
    expect(httpsms.send).toHaveBeenCalledOnce();
    expect(native.send).not.toHaveBeenCalled();
  });

  it('native-only never touches httpsms even when native fails', async () => {
    const { httpsms, router } = harness({ mode: 'native-only', native: providerFake('native', { accepted: false }) });

    await expect(router.send(request)).rejects.toThrow('sms_router_all_providers_failed');
    expect(httpsms.send).not.toHaveBeenCalled();
  });

  it('httpsms-only never touches native', async () => {
    const { native, router } = harness({ mode: 'httpsms-only' });

    await router.send(request);

    expect(native.send).not.toHaveBeenCalled();
  });

  it('throws with both provider failures listed when everything fails', async () => {
    const { router } = harness({
      native: providerFake('native', { throws: new Error('device offline') }),
      httpsms: providerFake('httpsms', { throws: new Error('httpsms_unauthorized') }),
    });

    await expect(router.send(request)).rejects.toThrow(/native.*device offline.*httpsms.*httpsms_unauthorized/su);
  });

  it('reconciles by requestId: a request already accepted is never resent, even to a different mode', async () => {
    const ledger = createMessageDeliveryLedger({ filename: ':memory:' });
    const first = harness({ mode: 'native-first', ledger });
    const firstResult = await first.router.send(request);

    // Second call, even in a different mode, must reconcile — not attempt any provider again.
    const second = harness({ mode: 'httpsms-first', ledger, native: first.native, httpsms: first.httpsms });
    const secondResult = await second.router.send(request);

    expect(secondResult).toEqual(firstResult);
    expect(first.native.send).toHaveBeenCalledOnce();
    expect(first.httpsms.send).not.toHaveBeenCalled();
  });

  it('dead-letters the request when all providers permanently fail, so a caller retry does not spam them', async () => {
    const ledger = createMessageDeliveryLedger({ filename: ':memory:' });
    const { router } = harness({
      mode: 'native-first', ledger,
      native: providerFake('native', { accepted: false }),
      httpsms: providerFake('httpsms', { accepted: false }),
    });

    await expect(router.send(request)).rejects.toThrow();
    const key = 'sms-outbound:router:req-1';
    expect(ledger.get(key).state).toBe('dead_letter');
  });
});
