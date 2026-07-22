import { describe, expect, it } from 'vitest';
import { createMessageDeliveryLedger, deliveryKeyFor } from '../src/messaging/message-delivery-ledger.mjs';

function harness() {
  return createMessageDeliveryLedger({ filename: ':memory:' });
}

describe('deliveryKeyFor', () => {
  it('builds a stable composite key and rejects missing parts', () => {
    expect(deliveryKeyFor({ channel: 'telegram', deviceId: 'huawei-1', messageId: 'opaque-2' }))
      .toBe('telegram:huawei-1:opaque-2');
    expect(() => deliveryKeyFor({ channel: 'telegram', deviceId: '', messageId: 'x' })).toThrow(TypeError);
  });
});

describe('createMessageDeliveryLedger', () => {
  it('claim() on a new key inserts a pending row and returns it', () => {
    const ledger = harness();
    const key = deliveryKeyFor({ channel: 'telegram', deviceId: 'huawei-1', messageId: 'm1' });

    const claimed = ledger.claim(key);

    expect(claimed).toMatchObject({ deliveryKey: key, state: 'pending', attempt: 0, replyText: null });
    expect(ledger.get(key)).toMatchObject({ state: 'pending' });
  });

  it('claim() on an existing key never resets it — same row returned, no LLM call needed twice', () => {
    const ledger = harness();
    const key = deliveryKeyFor({ channel: 'telegram', deviceId: 'huawei-1', messageId: 'm1' });
    ledger.claim(key);
    ledger.setState(key, 'reply_ready', { replyText: 'Bonjour' });

    const second = ledger.claim(key);

    expect(second).toMatchObject({ state: 'reply_ready', replyText: 'Bonjour' });
  });

  it('walks through the full state machine and persists patched fields', () => {
    const ledger = harness();
    const key = deliveryKeyFor({ channel: 'telegram', deviceId: 'huawei-1', messageId: 'm1' });
    ledger.claim(key);

    ledger.setState(key, 'generating');
    expect(ledger.get(key).state).toBe('generating');

    ledger.setState(key, 'reply_ready', { replyText: 'Salut Nasro' });
    expect(ledger.get(key)).toMatchObject({ state: 'reply_ready', replyText: 'Salut Nasro' });

    ledger.setState(key, 'sending');
    ledger.setState(key, 'sent', { providerMessageId: '42' });
    expect(ledger.get(key)).toMatchObject({ state: 'sent', providerMessageId: '42' });

    ledger.setState(key, 'acked');
    expect(ledger.get(key).state).toBe('acked');
  });

  it('scheduleRetry increments attempt and stores lastError/nextRetryAt', () => {
    const ledger = harness();
    const key = deliveryKeyFor({ channel: 'telegram', deviceId: 'huawei-1', messageId: 'm1' });
    ledger.claim(key);

    ledger.scheduleRetry(key, { lastError: 'rate_limited', nextRetryAt: 5_000 });
    expect(ledger.get(key)).toMatchObject({ state: 'retry_wait', attempt: 1, lastError: 'rate_limited', nextRetryAt: 5_000 });

    ledger.scheduleRetry(key, { lastError: 'transient', nextRetryAt: 9_000 });
    expect(ledger.get(key)).toMatchObject({ attempt: 2, lastError: 'transient', nextRetryAt: 9_000 });
  });

  it('markDeadLetter records the reason and freezes the row out of the retry loop', () => {
    const ledger = harness();
    const key = deliveryKeyFor({ channel: 'telegram', deviceId: 'huawei-1', messageId: 'm1' });
    ledger.claim(key);

    ledger.markDeadLetter(key, 'permanent_target');

    expect(ledger.get(key)).toMatchObject({ state: 'dead_letter', lastError: 'permanent_target' });
  });

  it('get() on an unknown key returns null, never throws', () => {
    const ledger = harness();
    expect(ledger.get(deliveryKeyFor({ channel: 'sms', deviceId: 'x', messageId: 'y' }))).toBeNull();
  });

  it('setState on an unknown key throws instead of silently inserting', () => {
    const ledger = harness();
    expect(() => ledger.setState(deliveryKeyFor({ channel: 'sms', deviceId: 'x', messageId: 'y' }), 'sent'))
      .toThrow('message_delivery_unknown_key');
  });

  it('survives across two independent ledger instances backed by the same file (simulated restart)', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory = await mkdtemp(join(tmpdir(), 'mina-ledger-'));
    const filename = join(directory, 'delivery.sqlite');
    try {
      const key = deliveryKeyFor({ channel: 'telegram', deviceId: 'huawei-1', messageId: 'm1' });
      const first = createMessageDeliveryLedger({ filename });
      first.claim(key);
      first.setState(key, 'reply_ready', { replyText: 'Persisté avant redémarrage' });
      first.close();

      const second = createMessageDeliveryLedger({ filename });
      expect(second.get(key)).toMatchObject({ state: 'reply_ready', replyText: 'Persisté avant redémarrage' });
      second.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
