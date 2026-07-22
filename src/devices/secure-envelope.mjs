import { createDecipheriv, createPublicKey, verify } from 'node:crypto';
import { parseEnvelope } from '../contracts/envelope.mjs';

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function base64(value, field, expectedBytes = null) {
  if (typeof value !== 'string' || !BASE64.test(value)) throw new TypeError(`envelope_${field}_invalid`);
  const bytes = Buffer.from(value, 'base64');
  if (expectedBytes !== null && bytes.length !== expectedBytes) throw new TypeError(`envelope_${field}_invalid`);
  return bytes;
}

function fields(envelope) {
  return [
    envelope.version,
    envelope.id,
    envelope.correlationId,
    envelope.channel,
    envelope.kind,
    envelope.createdAt,
    envelope.expiresAt ?? '',
    envelope.sender.identityId,
    envelope.sender.deviceId,
    envelope.counter,
    envelope.algorithms.encryption,
    envelope.algorithms.signature,
  ];
}

function framed(values) {
  return Buffer.from(values.map((value) => {
    const text = String(value);
    return `${Buffer.byteLength(text, 'utf8')}:${text}`;
  }).join('|'), 'utf8');
}

export function canonicalEnvelopeHeader(envelope) {
  return framed(fields(envelope));
}

export function canonicalEnvelopeSigningBytes(envelope) {
  return framed([
    ...fields(envelope), envelope.payloadCiphertext, envelope.nonce, envelope.authTag,
  ]);
}

export function verifyAndDecryptEnvelope({ envelope: input, aesKey, publicKey, now = Date.now(), lastCounter = 0 } = {}) {
  const envelope = parseEnvelope(input);
  if (!Number.isFinite(now)) throw new TypeError('envelope_time_invalid');
  if (!Number.isSafeInteger(lastCounter) || lastCounter < 0) throw new TypeError('envelope_counter_state_invalid');
  if (envelope.expiresAt !== null && Date.parse(envelope.expiresAt) <= now) throw new Error('envelope_expired');
  if (envelope.counter <= lastCounter) throw new Error('envelope_replay_rejected');

  const signature = base64(envelope.signature, 'signature');
  let key;
  try {
    key = createPublicKey({ key: base64(publicKey, 'public_key'), format: 'der', type: 'spki' });
  } catch (error) {
    throw new TypeError('envelope_public_key_invalid', { cause: error });
  }
  if (!verify('sha256', canonicalEnvelopeSigningBytes(envelope), key, signature)) {
    throw new Error('envelope_signature_invalid');
  }

  const keyBytes = Buffer.from(aesKey ?? []);
  if (keyBytes.length !== 32) throw new TypeError('envelope_aes_key_invalid');
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyBytes, base64(envelope.nonce, 'nonce', 12));
    decipher.setAAD(canonicalEnvelopeHeader(envelope));
    decipher.setAuthTag(base64(envelope.authTag, 'auth_tag', 16));
    const plaintext = Buffer.concat([
      decipher.update(base64(envelope.payloadCiphertext, 'ciphertext')),
      decipher.final(),
    ]);
    return Object.freeze({ counter: envelope.counter, plaintext });
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith('envelope_')) throw error;
    throw new Error('envelope_decryption_failed', { cause: error });
  }
}
