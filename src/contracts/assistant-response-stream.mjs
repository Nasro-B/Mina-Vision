import { TextDecoder } from 'node:util';
import { decodeChatPayload, encodeChatPayloadV2 } from './chat-payload.mjs';

export const ASSISTANT_RESPONSE_FRAME_TYPES = Object.freeze([
  'assistant.response.started',
  'assistant.response.chunk',
  'assistant.response.completed',
  'assistant.response.failed',
]);

export const MAX_ASSISTANT_RESPONSE_SEQUENCE = 999;
export const MAX_ASSISTANT_RESPONSE_CHUNK_BYTES = 8 * 1024;
export const MAX_ASSISTANT_RESPONSE_FINAL_BYTES = 32 * 1024;
export const ASSISTANT_RESPONSE_FAILED_CODES = Object.freeze([
  'generation_cancelled',
  'generation_failed',
  'provider_timeout',
  'provider_unavailable',
]);

const RESPONSE_TYPES = new Set(ASSISTANT_RESPONSE_FRAME_TYPES);
const FAILED_CODES = new Set(ASSISTANT_RESPONSE_FAILED_CODES);
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function fail(code) {
  throw new Error(code);
}

function bodyError(type) {
  return `assistant_response_${type.split('.').at(-1)}_body_invalid`;
}

function decodeUtf8(binary, code) {
  try {
    return UTF8_DECODER.decode(binary);
  } catch {
    fail(code);
  }
}

function encodeUtf8(text, code) {
  if (typeof text !== 'string') fail(code);
  const binary = Buffer.from(text, 'utf8');
  if (decodeUtf8(binary, code) !== text) fail(code);
  return binary;
}

function assertMeta(type, meta) {
  if (meta === null || Array.isArray(meta) || typeof meta !== 'object') fail('assistant_response_meta_invalid');
  const expected = type === 'assistant.response.failed'
    ? ['code', 'responseId', 'sequence', 'sourceEventId']
    : ['responseId', 'sequence', 'sourceEventId'];
  const keys = Object.keys(meta).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('assistant_response_meta_invalid');
  }
  if (typeof meta.responseId !== 'string' || typeof meta.sourceEventId !== 'string' || !Number.isInteger(meta.sequence)) {
    fail('assistant_response_meta_invalid');
  }
  if (type === 'assistant.response.failed' && typeof meta.code !== 'string') {
    fail('assistant_response_meta_invalid');
  }
  return {
    responseId: meta.responseId,
    sourceEventId: meta.sourceEventId,
    sequence: meta.sequence,
    code: type === 'assistant.response.failed' ? meta.code : null,
  };
}

function validateFrame({ type, responseId, sourceEventId, sequence, body, code }) {
  if (!RESPONSE_TYPES.has(type)) fail('assistant_response_type_invalid');
  if (!ULID_PATTERN.test(responseId) || !ULID_PATTERN.test(sourceEventId)) fail('assistant_response_id_invalid');
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > MAX_ASSISTANT_RESPONSE_SEQUENCE) {
    fail('assistant_response_sequence_invalid');
  }

  if (type === 'assistant.response.started') {
    if (sequence !== 0 || body.length !== 0 || code !== null) fail('assistant_response_started_body_invalid');
    return;
  }

  if (sequence < 1) fail('assistant_response_sequence_invalid');
  if (type === 'assistant.response.chunk') {
    if (body.length === 0 || body.length > MAX_ASSISTANT_RESPONSE_CHUNK_BYTES || code !== null) {
      fail('assistant_response_chunk_body_invalid');
    }
    return;
  }
  if (type === 'assistant.response.completed') {
    if (body.length === 0 || body.length > MAX_ASSISTANT_RESPONSE_FINAL_BYTES || code !== null) {
      fail('assistant_response_completed_body_invalid');
    }
    return;
  }
  if (body.length !== 0) fail('assistant_response_failed_body_invalid');
  if (!FAILED_CODES.has(code)) fail('assistant_response_code_invalid');
}

function encodeBody(type, text) {
  if (type === 'assistant.response.started' || type === 'assistant.response.failed') {
    if (text !== undefined && text !== null) fail(bodyError(type));
    return Buffer.alloc(0);
  }
  return encodeUtf8(text, bodyError(type));
}

/**
 * Encode une trame de réponse dans un payload v2 avant chiffrement de l'enveloppe mina_app.
 * Le corps final/chunk reste dans la section binaire pour séparer explicitement le texte
 * sensible des métadonnées de corrélation.
 */
export function encodeAssistantResponseFrame({ type, responseId, sourceEventId, sequence, text, code = null } = {}) {
  if (!RESPONSE_TYPES.has(type)) fail('assistant_response_type_invalid');
  const body = encodeBody(type, text);
  validateFrame({ type, responseId, sourceEventId, sequence, body, code });
  const meta = { responseId, sourceEventId, sequence };
  if (code !== null) meta.code = code;
  return encodeChatPayloadV2({ type, meta, binary: body });
}

/** Décode et valide une trame authentifiée de réponse progressive. */
export function decodeAssistantResponseFrame(payload) {
  const decoded = decodeChatPayload(payload);
  if (decoded.version !== 2 || !RESPONSE_TYPES.has(decoded.type)) fail('assistant_response_payload_invalid');
  const { responseId, sourceEventId, sequence, code } = assertMeta(decoded.type, decoded.meta);
  const body = Buffer.from(decoded.binary);
  validateFrame({ type: decoded.type, responseId, sourceEventId, sequence, body, code });
  const text = body.length === 0 ? null : decodeUtf8(body, bodyError(decoded.type));
  return Object.freeze({ type: decoded.type, responseId, sourceEventId, sequence, text, code });
}
