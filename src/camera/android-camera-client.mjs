import { createHash, timingSafeEqual } from 'node:crypto';
import { verifyDeviceProof } from '../devices/device-identity-proof.mjs';

const ENVELOPE_FIELDS = [
  'capturedAtMs', 'challenge', 'deviceId', 'file', 'height', 'jpegQuality', 'lens', 'mimeType',
  'publicKeySpkiBase64', 'rotation', 'sequence', 'sessionId', 'sha256', 'signatureBase64', 'version', 'width',
].sort().join(',');
const SESSION_ID = /^cam-[a-f0-9]{32}$/u;
const FRAME_FILE = /^frame-[1-9][0-9]*\.jpg$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function challengeFor(envelope) {
  return [
    'mina-camera-frame-v1', envelope.sessionId, envelope.sequence, envelope.capturedAtMs,
    envelope.lens.toUpperCase(), envelope.rotation, envelope.width, envelope.height,
    envelope.mimeType, envelope.jpegQuality, envelope.sha256,
  ].join('|');
}

function sameHex(left, right) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateAndroidCameraFrame(value, {
  expectedDeviceId,
  nowMs = Date.now(),
  previousSequence = 0,
  maxAgeMs = 5_000,
  maxFutureSkewMs = 10_000,
} = {}) {
  const envelope = value?.envelope;
  const jpeg = Buffer.isBuffer(value?.jpeg) ? value.jpeg : null;
  if (!envelope || Object.keys(envelope).sort().join(',') !== ENVELOPE_FIELDS || envelope.version !== 1
    || !SESSION_ID.test(envelope.sessionId ?? '') || !FRAME_FILE.test(envelope.file ?? '')
    || !Number.isSafeInteger(envelope.sequence) || envelope.sequence < 1
    || !Number.isSafeInteger(envelope.capturedAtMs) || envelope.capturedAtMs < 1
    || !['front', 'back', 'external'].includes(envelope.lens)
    || ![0, 90, 180, 270].includes(envelope.rotation)
    || !Number.isSafeInteger(envelope.width) || envelope.width < 1 || envelope.width > 4_096
    || !Number.isSafeInteger(envelope.height) || envelope.height < 1 || envelope.height > 4_096
    || envelope.mimeType !== 'image/jpeg' || envelope.jpegQuality !== 75 || !SHA256.test(envelope.sha256 ?? '')) {
    throw new Error('camera_frame_envelope_invalid');
  }
  if (envelope.deviceId !== expectedDeviceId) throw new Error('camera_device_mismatch');
  if (envelope.sequence <= previousSequence) throw new Error('camera_frame_replay');
  if (envelope.capturedAtMs > nowMs + maxFutureSkewMs || nowMs - envelope.capturedAtMs > maxAgeMs) {
    throw new Error('camera_frame_expired');
  }
  if (!jpeg || jpeg.length < 4 || jpeg.length > 350 * 1024
    || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff
    || jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) {
    throw new Error('camera_jpeg_invalid');
  }
  const digest = createHash('sha256').update(jpeg).digest('hex');
  if (!sameHex(digest, envelope.sha256)) throw new Error('camera_frame_hash_invalid');
  const expectedChallenge = challengeFor(envelope);
  if (envelope.challenge !== expectedChallenge || !verifyDeviceProof({
    deviceId: envelope.deviceId,
    publicKeySpkiBase64: envelope.publicKeySpkiBase64,
    challenge: envelope.challenge,
    signatureBase64: envelope.signatureBase64,
  })) throw new Error('camera_frame_signature_invalid');

  return Object.freeze({
    sessionId: envelope.sessionId,
    sequence: envelope.sequence,
    capturedAtMs: envelope.capturedAtMs,
    lens: envelope.lens,
    rotation: envelope.rotation,
    width: envelope.width,
    height: envelope.height,
    mimeType: envelope.mimeType,
    sha256: envelope.sha256,
    deviceId: envelope.deviceId,
    jpeg: Buffer.from(jpeg),
  });
}

export function createAndroidCameraClient({
  phoneBridge,
  now = Date.now,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (!phoneBridge) throw new TypeError('camera_phone_bridge_required');
  let active = false;
  let expectedDeviceId = null;
  let intervalMs = 200;
  let previousSequence = 0;
  let startedAtMs = 0;

  return Object.freeze({
    start: async ({ deviceId, lens = 'front', maxFps = 5 } = {}) => {
      if (active) throw new Error('camera_stream_already_active');
      if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(deviceId ?? '')
        || !['front', 'back'].includes(lens) || !Number.isInteger(maxFps) || maxFps < 1 || maxFps > 5) {
        throw new TypeError('camera_stream_request_invalid');
      }
      const detected = await phoneBridge.detect();
      if (detected.deviceId !== deviceId) throw new Error('camera_device_mismatch');
      await phoneBridge.startSensorCameraStream({ lens, maxFps });
      expectedDeviceId = deviceId;
      intervalMs = Math.ceil(1_000 / maxFps);
      previousSequence = 0;
      startedAtMs = now();
      active = true;
      return Object.freeze({ active: true, deviceId, lens, maxFps });
    },
    frames: async function* frames() {
      if (!active) throw new Error('camera_stream_inactive');
      while (active) {
        await phoneBridge.touchCameraKeepalive();
        const raw = await phoneBridge.readLatestCameraFrame();
        if (raw) {
          const frame = validateAndroidCameraFrame(raw, {
            expectedDeviceId, nowMs: now(), previousSequence,
          });
          previousSequence = frame.sequence;
          yield frame;
        } else if (now() - startedAtMs > 15_000) {
          throw new Error('camera_stream_start_timeout');
        }
        if (active) await wait(intervalMs);
      }
    },
    stop: async () => {
      if (!active) return Object.freeze({ stopped: false });
      active = false;
      await phoneBridge.stopSensorCameraStream();
      expectedDeviceId = null;
      previousSequence = 0;
      return Object.freeze({ stopped: true });
    },
  });
}
