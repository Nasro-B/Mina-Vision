import { deliveryKeyFor } from '../messaging/message-delivery-ledger.mjs';
import * as defaultRetryPolicy from '../messaging/message-retry-policy.mjs';

const TELEGRAM_ID = /^[1-9][0-9]{0,18}$/u;
const TELEGRAM_LONG_MAX = 9_223_372_036_854_775_807n;

export function telegramReplyTarget(sender) {
  const parts = String(sender ?? '').split(':');
  if (parts.length === 1 && TELEGRAM_ID.test(parts[0]) && BigInt(parts[0]) <= TELEGRAM_LONG_MAX) return parts[0];
  if (parts.length !== 2 || !parts.every((part) => TELEGRAM_ID.test(part)
    && BigInt(part) <= TELEGRAM_LONG_MAX) || parts[0] !== parts[1]) {
    throw new TypeError('telegram_reply_target_invalid');
  }
  return parts[1];
}

const DONE_STATES = new Set(['sent', 'acked', 'dead_letter']);

export function createPhoneMessageSync({
  phoneBridge,
  memoryController,
  telegramResponder,
  ledger,
  retryPolicy = defaultRetryPolicy,
  now = () => Date.now(),
} = {}) {
  if (!phoneBridge?.detect || !phoneBridge?.ensureGatewayService || !phoneBridge?.pullPendingMessages
    || !phoneBridge?.ackPendingMessages || !phoneBridge?.sendTelegramMessage
    || !memoryController?.rememberRemoteMessage || !telegramResponder?.reply
    || !ledger?.claim || !ledger?.get || !ledger?.setState || !ledger?.scheduleRetry || !ledger?.markDeadLetter) {
    throw new TypeError('phone_message_sync_dependencies_required');
  }
  let inFlight = null;

  // Runs (or resumes) exactly the missing steps for ONE Telegram message, driven by its ledger
  // state — never re-generates a reply that is already reply_ready/sent, never re-sends one
  // already sent. A failure here is classified and either scheduled for retry (message stays
  // un-acked, the device redelivers it) or dead-lettered (acked anyway, to drain the queue).
  async function advanceTelegramMessage(message, deviceId) {
    const key = deliveryKeyFor({ channel: 'telegram', deviceId, messageId: message.id });
    let record = ledger.claim(key);
    if (DONE_STATES.has(record.state)) return record;
    try {
      let chatId;
      // Driven by DATA, not by the state name: 'retry_wait' can mean "failed while generating"
      // OR "failed while sending" — only the presence of a persisted replyText tells them apart.
      if (!record.replyText) {
        chatId = telegramReplyTarget(message.sender);
        record = ledger.setState(key, 'generating');
        const text = await telegramResponder.reply(message);
        record = ledger.setState(key, 'reply_ready', { replyText: text });
      }
      if (record.state !== 'sent') {
        chatId = chatId ?? telegramReplyTarget(message.sender);
        ledger.setState(key, 'sending');
        const sendResult = await phoneBridge.sendTelegramMessage({ sourceMessageId: message.id, chatId, text: record.replyText });
        record = ledger.setState(key, 'sent', { providerMessageId: sendResult?.providerMessageId ?? null });
      }
      return record;
    } catch (error) {
      const classification = retryPolicy.classifyMessagingError(error);
      const attempt = record.attempt + 1;
      if (retryPolicy.shouldDeadLetter({ attempt, kind: classification.kind })) {
        return ledger.markDeadLetter(key, error.message);
      }
      const delayMs = retryPolicy.nextRetryDelayMs({ attempt, kind: classification.kind, retryAfterMs: classification.retryAfterMs });
      return ledger.scheduleRetry(key, { lastError: error.message, nextRetryAt: now() + delayMs });
    }
  }

  async function synchronize() {
    const device = await phoneBridge.detect();
    if (!device?.deviceId) throw new Error('phone_identity_unavailable');
    await phoneBridge.ensureGatewayService();
    const batch = await phoneBridge.pullPendingMessages({ limit: 50 });
    if (!Array.isArray(batch?.messages)) throw new Error('phone_message_batch_invalid');
    if (batch.messages.length === 0) return Object.freeze({ pulled: 0, stored: 0, replied: 0, acked: 0 });

    const toAck = [];
    let replied = 0;
    for (const message of batch.messages) {
      // Durable-write-before-anything is unconditional: a failure here still aborts the whole
      // batch — it protects against ever losing a message, independent of the delivery ledger.
      await memoryController.rememberRemoteMessage({ ...message, deviceId: device.deviceId });
      if (message.channel !== 'telegram') {
        toAck.push(message.id);
        continue;
      }
      const record = await advanceTelegramMessage(message, device.deviceId);
      if (record.state === 'retry_wait') continue; // left un-acked on purpose: device redelivers it
      toAck.push(message.id);
      if (record.state === 'sent') replied += 1;
    }
    if (toAck.length === 0) return Object.freeze({ pulled: batch.messages.length, stored: batch.messages.length, replied, acked: 0 });

    const receipt = await phoneBridge.ackPendingMessages({ messageIds: toAck });
    for (const message of batch.messages) {
      if (message.channel === 'telegram' && toAck.includes(message.id)) {
        const key = deliveryKeyFor({ channel: 'telegram', deviceId: device.deviceId, messageId: message.id });
        if (ledger.get(key)?.state === 'sent') ledger.setState(key, 'acked');
      }
    }
    return Object.freeze({ pulled: batch.messages.length, stored: batch.messages.length, replied, acked: receipt.acked });
  }

  async function run() {
    if (inFlight) return inFlight;
    inFlight = synchronize();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return Object.freeze({ run });
}
