// Clean-room specification of the public httpSMS-style REST protocol, written from the plan's
// own requirements (auth header, POST /v1/messages/send, async statuses, webhooks, idempotent
// request ids, rate limits) — NEVER from the AGPL httpsms-main.zip source, which is not read by
// this codebase at all. This file is pure data/validation, no network code.

export const SEND_ENDPOINT = '/v1/messages/send';
export const STATUS_ENDPOINT = (id) => `/v1/messages/${id}`;

export const MESSAGE_STATES = Object.freeze(['pending', 'sent', 'delivered', 'failed']);

const E164 = /^\+[1-9][0-9]{7,14}$/u;
const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/u;

export function validateSendRequest({ from, to, content, requestId } = {}) {
  if (!E164.test(String(from ?? ''))) throw new TypeError('httpsms_sender_invalid');
  if (!E164.test(String(to ?? ''))) throw new TypeError('httpsms_recipient_invalid');
  if (typeof content !== 'string' || content.length < 1 || content.length > 1_600) throw new TypeError('httpsms_content_invalid');
  if (!REQUEST_ID.test(String(requestId ?? ''))) throw new TypeError('httpsms_request_id_invalid');
  return Object.freeze({ from, to, content, requestId });
}

// Inbound-message webhook event names (received SMS). Delivery-status events (message.sent /
// message.delivered / message.failed) are NOT inbound messages and are ignored by the server.
export const INBOUND_EVENTS = Object.freeze(['message.received', 'message.phone.received']);

// Normalizes an already-signature-verified webhook payload to the same shape the native SMS path
// stores (see phone-message-sync.mjs). Returns null for a non-message event rather than throwing —
// a delivery-status callback is legitimate traffic, just not something to remember as a message.
export function normalizeInboundWebhook(payload) {
  if (!payload || typeof payload !== 'object' || !INBOUND_EVENTS.includes(payload.event)) return null;
  const data = payload.data ?? {};
  const id = String(data.id ?? '');
  const sender = String(data.from ?? '');
  const recipient = String(data.to ?? '');
  const body = String(data.content ?? '');
  if (!id || !sender || !body) throw new TypeError('httpsms_inbound_payload_invalid');
  const parsedAt = Date.parse(data.timestamp ?? '');
  return Object.freeze({
    channel: 'sms',
    providerId: 'httpsms',
    id,
    sender,
    recipient,
    body,
    sentAtMs: Number.isFinite(parsedAt) ? parsedAt : null,
  });
}
