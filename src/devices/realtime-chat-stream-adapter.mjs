const IDENTIFIER = /^[A-Za-z0-9._:-]{1,160}$/u;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const MAX_CIPHERTEXT_CHARS = 16_384;
const MAX_TTL_MS = 10 * 60 * 1_000;
const MAX_SEQUENCE = 999;
const MIN_PUBLISH_INTERVAL_MS = 350;

function isCanonicalBase64(value) {
  return STANDARD_BASE64.test(value) && Buffer.from(value, 'base64').toString('base64') === value;
}

function clockNow(clock) {
  const value = Number(typeof clock === 'function' ? clock() : clock?.now?.());
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('chat_stream_clock_invalid');
  return value;
}

function assertOwnerIdentity(ownerIdentity) {
  if (ownerIdentity?.isMinaBrain !== true
    || ownerIdentity.deviceId !== 'mina-brain'
    || !IDENTIFIER.test(ownerIdentity.ownerId ?? '')) {
    throw new TypeError('chat_stream_owner_identity_required');
  }
}

function assertFrame(frame, ownerId, now) {
  if (ownerId !== frame?.ownerId || !IDENTIFIER.test(ownerId ?? '')) {
    throw new TypeError('chat_stream_owner_invalid');
  }
  if (!ULID.test(frame.responseId ?? '')) throw new TypeError('chat_stream_response_id_invalid');
  if (!Number.isInteger(frame.sequence) || frame.sequence < 1 || frame.sequence > MAX_SEQUENCE) {
    throw new TypeError('chat_stream_sequence_invalid');
  }
  if (typeof frame.ciphertext !== 'string'
    || !frame.ciphertext
    || frame.ciphertext.length > MAX_CIPHERTEXT_CHARS
    || !isCanonicalBase64(frame.ciphertext)) {
    throw new TypeError('chat_stream_ciphertext_invalid');
  }
  if (!Number.isSafeInteger(frame.expiresAtMs) || frame.expiresAtMs <= now || frame.expiresAtMs > now + MAX_TTL_MS) {
    throw new RangeError('chat_stream_expiry_invalid');
  }
}

export function createRealtimeChatStreamAdapter({
  database,
  ownerIdentity,
  clock = Date.now,
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
} = {}) {
  if (typeof database?.update !== 'function') throw new TypeError('chat_stream_database_required');
  if (typeof schedule !== 'function') throw new TypeError('chat_stream_scheduler_required');
  assertOwnerIdentity(ownerIdentity);

  const queues = new Map();

  function scheduleFlush(queue, delayMs) {
    if (queue.timer !== null || queue.flushing) return;
    queue.timer = schedule(() => {
      queue.timer = null;
      return flush(queue);
    }, delayMs);
  }

  async function flush(queue) {
    if (queue.flushing || queue.entries.length === 0) return;
    queue.flushing = true;
    const entries = queue.entries.splice(0);
    const values = Object.fromEntries(entries.map((entry) => [
      `streams/${ownerIdentity.ownerId}/${entry.responseId}/frames/${entry.sequence}`,
      {
        ciphertext: entry.ciphertext,
        sequence: entry.sequence,
        expiresAt: entry.expiresAtMs,
      },
    ]));

    try {
      await database.update(values);
      queue.lastPublishedAt = clockNow(clock);
      for (const entry of entries) {
        entry.resolve(Object.freeze({ responseId: entry.responseId, sequence: entry.sequence }));
      }
    } catch (error) {
      for (const entry of entries) entry.reject(error);
    } finally {
      queue.flushing = false;
      if (queue.entries.length > 0) {
        const elapsed = clockNow(clock) - queue.lastPublishedAt;
        scheduleFlush(queue, Math.max(0, MIN_PUBLISH_INTERVAL_MS - elapsed));
      }
    }
  }

  function publishFrame(frame) {
    const now = clockNow(clock);
    assertFrame(frame, ownerIdentity.ownerId, now);
    let queue = queues.get(frame.responseId);
    if (!queue) {
      queue = { entries: [], flushing: false, lastPublishedAt: null, timer: null };
      queues.set(frame.responseId, queue);
    }
    return new Promise((resolve, reject) => {
      queue.entries.push({ ...frame, resolve, reject });
      const delayMs = queue.lastPublishedAt === null
        ? 0
        : Math.max(0, MIN_PUBLISH_INTERVAL_MS - (now - queue.lastPublishedAt));
      scheduleFlush(queue, delayMs);
    });
  }

  return Object.freeze({ publishFrame });
}
