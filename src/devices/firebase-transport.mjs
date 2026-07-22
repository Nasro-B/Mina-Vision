const MAX_TTL_MS = 24 * 60 * 60 * 1_000;
const ID = /^[A-Za-z0-9._:-]{1,200}$/u;
const FORBIDDEN_KIND = /^(?:camera\.|face\.|email\.body|secret\.)/u;
const ENCRYPTED_FIELDS = Object.freeze([
  'version', 'id', 'correlationId', 'channel', 'kind', 'createdAt', 'expiresAt', 'sender', 'counter',
  'algorithms', 'payloadCiphertext', 'nonce', 'authTag', 'signature',
]);
const PLAINTEXT_KEYS = /^(?:plaintext|body|text|content|audio|frame|embedding|token|secret)$/iu;

function safeRecord(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !ID.test(envelope.id ?? '')
    || envelope.version !== 1 || typeof envelope.kind !== 'string' || FORBIDDEN_KIND.test(envelope.kind)
    || typeof envelope.payloadCiphertext !== 'string' || !envelope.payloadCiphertext
    || typeof envelope.nonce !== 'string' || typeof envelope.authTag !== 'string' || typeof envelope.signature !== 'string') {
    if (FORBIDDEN_KIND.test(envelope?.kind ?? '')) throw new Error('firebase_payload_forbidden');
    throw new TypeError('firebase_envelope_invalid');
  }
  if (Object.keys(envelope).some((key) => PLAINTEXT_KEYS.test(key))) throw new Error('firebase_plaintext_forbidden');
  return Object.freeze(Object.fromEntries(ENCRYPTED_FIELDS.filter((key) => Object.hasOwn(envelope, key)).map((key) => [key, structuredClone(envelope[key])])));
}

export function createFirebaseTransport({ backend, clock = Date.now, directAvailable = () => false } = {}) {
  if (!backend?.put || !backend?.get || !backend?.remove || typeof directAvailable !== 'function') {
    throw new TypeError('firebase_transport_dependencies_required');
  }
  const consumed = new Set();
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  async function enqueue(input) {
    if (directAvailable()) throw new Error('firebase_direct_transport_available');
    const record = safeRecord(input);
    const createdAt = Date.parse(record.createdAt);
    const expiresAt = Date.parse(record.expiresAt);
    if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= now()) throw new Error('firebase_envelope_expired');
    if (expiresAt - createdAt > MAX_TTL_MS) throw new Error('firebase_ttl_exceeded');
    await backend.put(record.id, record);
    return Object.freeze({ queued: true, envelopeId: record.id, expiresAt: record.expiresAt });
  }

  async function receive(envelopeId) {
    if (!ID.test(envelopeId ?? '')) throw new TypeError('firebase_envelope_id_invalid');
    if (consumed.has(envelopeId)) return Object.freeze({ duplicate: true, envelopeId });
    const record = await backend.get(envelopeId);
    if (!record) throw new Error('firebase_envelope_unknown');
    if (Date.parse(record.expiresAt) <= now()) {
      await backend.remove(envelopeId);
      throw new Error('firebase_envelope_expired');
    }
    const envelope = safeRecord(record);
    consumed.add(envelopeId);
    await backend.remove(envelopeId);
    return Object.freeze({ envelope, capabilities: Object.freeze([]) });
  }

  return Object.freeze({ enqueue, receive });
}
