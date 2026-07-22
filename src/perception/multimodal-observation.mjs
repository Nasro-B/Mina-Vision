import { createHash } from 'node:crypto';

const LENSES = new Set(['front', 'back']);
const MAX_BLOCKS = 500;

function digestOf(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function requireBytes(bytes, errorCode) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1) throw new TypeError(errorCode);
}

function requireTimestamp(observedAtMs, errorCode) {
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 1) throw new TypeError(errorCode);
}

export function createScreenModality({ bytes, observedAtMs } = {}) {
  requireBytes(bytes, 'screen_modality_bytes_invalid');
  requireTimestamp(observedAtMs, 'screen_modality_time_invalid');
  return Object.freeze({ digest: digestOf(bytes), source: 'desktop', observedAtMs });
}

export function createWebModality({ bytes, observedAtMs } = {}) {
  requireBytes(bytes, 'web_modality_bytes_invalid');
  requireTimestamp(observedAtMs, 'web_modality_time_invalid');
  return Object.freeze({ digest: digestOf(bytes), source: 'playwright', observedAtMs });
}

export function createCameraModality({ bytes, deviceId, lens, observedAtMs } = {}) {
  requireBytes(bytes, 'camera_modality_bytes_invalid');
  requireTimestamp(observedAtMs, 'camera_modality_time_invalid');
  if (typeof deviceId !== 'string' || deviceId.length < 1 || deviceId.length > 160) {
    throw new TypeError('camera_modality_device_invalid');
  }
  if (!LENSES.has(lens)) throw new TypeError('camera_modality_lens_invalid');
  return Object.freeze({ digest: digestOf(bytes), source: 'phone-camera', deviceId, lens, observedAtMs });
}

export function createOcrModality({ blocks, modelId, observedAtMs } = {}) {
  if (!Array.isArray(blocks) || blocks.length > MAX_BLOCKS) throw new TypeError('ocr_modality_blocks_invalid');
  if (typeof modelId !== 'string' || modelId.length < 1 || modelId.length > 160) {
    throw new TypeError('ocr_modality_model_invalid');
  }
  requireTimestamp(observedAtMs, 'ocr_modality_time_invalid');
  return Object.freeze({
    blocks: Object.freeze(blocks.map((block) => Object.freeze({ ...block }))),
    modelId,
    observedAtMs,
  });
}
