import { describe, expect, it, vi } from 'vitest';
import { createPhoneMessageSync } from '../src/devices/phone-message-sync.mjs';
import { createMessageDeliveryLedger, deliveryKeyFor } from '../src/messaging/message-delivery-ledger.mjs';

const messages = Object.freeze([
  Object.freeze({ id: 'opaque-1', channel: 'sms', sender: '+33600000000', body: 'Bonjour Mina', sentAtMs: 2_000 }),
  Object.freeze({ id: 'opaque-2', channel: 'telegram', sender: '123456789:123456789', body: 'Rappelle-moi demain', sentAtMs: 3_000 }),
]);

function harness({ failAt = -1, ledger = createMessageDeliveryLedger({ filename: ':memory:' }) } = {}) {
  let calls = 0;
  const phoneBridge = {
    detect: vi.fn(async () => ({ deviceId: 'huawei-primary' })),
    ensureGatewayService: vi.fn(async () => ({ running: true })),
    pullPendingMessages: vi.fn(async () => ({ batchId: 'pull-1', messages })),
    ackPendingMessages: vi.fn(async ({ messageIds }) => ({ batchId: 'ack-1', acked: messageIds.length })),
    sendTelegramMessage: vi.fn(async () => ({ state: 'accepted_by_provider', providerMessageId: '42' })),
  };
  const memoryController = {
    rememberRemoteMessage: vi.fn(async () => {
      calls += 1;
      if (calls === failAt) throw new Error('durable_write_failed');
      return { duplicateSafe: true };
    }),
  };
  const telegramResponder = {
    reply: vi.fn(async () => 'Bonjour depuis Mina Vision.'),
  };
  return {
    phoneBridge,
    memoryController,
    telegramResponder,
    ledger,
    sync: createPhoneMessageSync({ phoneBridge, memoryController, telegramResponder, ledger }),
  };
}

describe('phone message sync', () => {
  it('throws when constructed without its required dependencies (ledger included)', () => {
    expect(() => createPhoneMessageSync({})).toThrow(TypeError);
  });

  it('acknowledges phone messages only after every durable memory write succeeds', async () => {
    const { phoneBridge, memoryController, sync } = harness();

    await expect(sync.run()).resolves.toEqual({ pulled: 2, stored: 2, replied: 1, acked: 2 });
    expect(memoryController.rememberRemoteMessage).toHaveBeenNthCalledWith(1, { ...messages[0], deviceId: 'huawei-primary' });
    expect(phoneBridge.ensureGatewayService).toHaveBeenCalledOnce();
    expect(phoneBridge.sendTelegramMessage).toHaveBeenCalledWith({
      sourceMessageId: 'opaque-2', chatId: '123456789', text: 'Bonjour depuis Mina Vision.',
    });
    expect(phoneBridge.ackPendingMessages).toHaveBeenCalledWith({ messageIds: ['opaque-1', 'opaque-2'] });
    expect(memoryController.rememberRemoteMessage.mock.invocationCallOrder[1])
      .toBeLessThan(phoneBridge.ackPendingMessages.mock.invocationCallOrder[0]);
  });

  it('never acknowledges a batch when a durable memory write fails', async () => {
    const { phoneBridge, sync } = harness({ failAt: 2 });

    await expect(sync.run()).rejects.toThrow('durable_write_failed');
    expect(phoneBridge.ackPendingMessages).not.toHaveBeenCalled();
  });

  it('does not emit an empty acknowledgement', async () => {
    const { phoneBridge, sync } = harness();
    phoneBridge.pullPendingMessages.mockResolvedValue({ batchId: 'pull-empty', messages: [] });

    await expect(sync.run()).resolves.toEqual({ pulled: 0, stored: 0, replied: 0, acked: 0 });
    expect(phoneBridge.ackPendingMessages).not.toHaveBeenCalled();
  });

  it('coalesces overlapping polls into one in-flight synchronization', async () => {
    const { phoneBridge, sync } = harness();
    const first = sync.run();
    const second = sync.run();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { pulled: 2, stored: 2, replied: 1, acked: 2 },
      { pulled: 2, stored: 2, replied: 1, acked: 2 },
    ]);
    expect(phoneBridge.pullPendingMessages).toHaveBeenCalledTimes(1);
  });

  describe('idempotent redelivery (crash / restart at any point never doubles the LLM call or the send)', () => {
    it('a transient send failure leaves the message un-acked (redelivered), and the RETRY never regenerates the reply', async () => {
      const ledger = createMessageDeliveryLedger({ filename: ':memory:' });
      const { phoneBridge, telegramResponder, sync } = harness({ ledger });
      phoneBridge.sendTelegramMessage.mockRejectedValueOnce(new Error('ETIMEDOUT'));
      phoneBridge.pullPendingMessages.mockResolvedValue({ batchId: 'pull-1', messages: [messages[1]] });

      const first = await sync.run();
      expect(first).toEqual({ pulled: 1, stored: 1, replied: 0, acked: 0 }); // left pending, not acked
      expect(telegramResponder.reply).toHaveBeenCalledTimes(1);
      expect(phoneBridge.ackPendingMessages).not.toHaveBeenCalled();

      // Device redelivers the SAME message on the next poll (still pending on its side).
      const second = await sync.run();
      expect(second).toEqual({ pulled: 1, stored: 1, replied: 1, acked: 1 });
      expect(telegramResponder.reply).toHaveBeenCalledTimes(1); // NEVER called twice
      expect(phoneBridge.sendTelegramMessage).toHaveBeenCalledTimes(2); // retried the send only
    });

    it('a crash after the reply is persisted but before send resumes straight to sending on redelivery', async () => {
      const ledger = createMessageDeliveryLedger({ filename: ':memory:' });
      const key = deliveryKeyFor({ channel: 'telegram', deviceId: 'huawei-primary', messageId: 'opaque-2' });
      ledger.claim(key);
      ledger.setState(key, 'reply_ready', { replyText: 'Réponse déjà générée avant le crash' });
      const { phoneBridge, telegramResponder, sync } = harness({ ledger });
      phoneBridge.pullPendingMessages.mockResolvedValue({ batchId: 'pull-1', messages: [messages[1]] });

      await sync.run();

      expect(telegramResponder.reply).not.toHaveBeenCalled();
      expect(phoneBridge.sendTelegramMessage).toHaveBeenCalledWith({
        sourceMessageId: 'opaque-2', chatId: '123456789', text: 'Réponse déjà générée avant le crash',
      });
    });

    it('a message already fully sent-and-acked in a prior run is never regenerated or resent on redelivery', async () => {
      const ledger = createMessageDeliveryLedger({ filename: ':memory:' });
      const key = deliveryKeyFor({ channel: 'telegram', deviceId: 'huawei-primary', messageId: 'opaque-2' });
      ledger.claim(key);
      ledger.setState(key, 'acked', { replyText: 'Déjà tout fait', providerMessageId: '99' });
      const { phoneBridge, telegramResponder, sync } = harness({ ledger });
      phoneBridge.pullPendingMessages.mockResolvedValue({ batchId: 'pull-1', messages: [messages[1]] });

      const result = await sync.run();

      expect(telegramResponder.reply).not.toHaveBeenCalled();
      expect(phoneBridge.sendTelegramMessage).not.toHaveBeenCalled();
      expect(phoneBridge.ackPendingMessages).toHaveBeenCalledWith({ messageIds: ['opaque-2'] }); // still re-acked, harmless
      expect(result.replied).toBe(0);
    });

    it('an invalid Telegram sender is dead-lettered and drained (acked) instead of blocking the whole batch forever', async () => {
      const { phoneBridge, telegramResponder, sync } = harness();
      phoneBridge.pullPendingMessages.mockResolvedValue({
        batchId: 'pull-invalid',
        messages: [messages[0], { ...messages[1], sender: 'invalid:target:shape' }],
      });

      const result = await sync.run();

      expect(telegramResponder.reply).not.toHaveBeenCalled();
      expect(phoneBridge.sendTelegramMessage).not.toHaveBeenCalled();
      // Both messages are still acked — the SMS because it always is, the malformed Telegram one
      // because it's permanently undeliverable and must not loop forever on the device.
      expect(phoneBridge.ackPendingMessages).toHaveBeenCalledWith({ messageIds: ['opaque-1', 'opaque-2'] });
      expect(result.replied).toBe(0);
    });

    it('a persistently failing reply generation dead-letters after the retry budget instead of looping forever', async () => {
      const ledger = createMessageDeliveryLedger({ filename: ':memory:' });
      const { phoneBridge, telegramResponder, sync } = harness({ ledger });
      telegramResponder.reply.mockRejectedValue(new Error('ETIMEDOUT'));
      phoneBridge.pullPendingMessages.mockResolvedValue({ batchId: 'pull-1', messages: [messages[1]] });

      for (let i = 0; i < 5; i += 1) await sync.run();

      const key = deliveryKeyFor({ channel: 'telegram', deviceId: 'huawei-primary', messageId: 'opaque-2' });
      expect(ledger.get(key).state).toBe('dead_letter');
      const finalResult = await sync.run();
      expect(finalResult.acked).toBe(1); // drained on the device even though it was never answered
      expect(telegramResponder.reply).toHaveBeenCalledTimes(5); // no 6th attempt once dead-lettered
    });

    it('an SMS message is unaffected by a Telegram message failing in the same batch', async () => {
      const { phoneBridge, sync } = harness();
      phoneBridge.sendTelegramMessage.mockRejectedValue(new Error('ETIMEDOUT'));

      const result = await sync.run();

      expect(result.acked).toBe(1); // the SMS
      expect(phoneBridge.ackPendingMessages).toHaveBeenCalledWith({ messageIds: ['opaque-1'] });
    });
  });
});
