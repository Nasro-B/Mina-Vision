const DEVICE_ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const IDENTITY_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const LENSES = new Set(['front', 'back']);
const ANGLES = new Set(['front', 'left', 'right']);
const PREVIEW_MIN_INTERVAL_MS = 500; // enforces a preview cadence of at most 2 FPS

function exactShape(value, fields, error) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    throw new TypeError(error);
  }
  return value;
}

function decodeSample(sample) {
  const { imageBase64, angle } = exactShape(sample, ['angle', 'imageBase64'], 'camera_ui_request_invalid');
  if (!ANGLES.has(angle) || typeof imageBase64 !== 'string' || imageBase64.length < 1) {
    throw new TypeError('camera_ui_request_invalid');
  }
  return { image: Buffer.from(imageBase64, 'base64'), angle };
}

export function createCameraController({ phoneBridge, cameraClient, faceRecognizer, profileStore, now = Date.now } = {}) {
  if (!phoneBridge?.detect || !cameraClient?.start || !cameraClient?.stop || !cameraClient?.frames
    || !faceRecognizer?.enroll || !profileStore?.delete) {
    throw new TypeError('camera_controller_dependencies_required');
  }

  let active = false;
  let lens = null;
  let deviceId = null;
  let lastPreviewAtMs = -Infinity;

  async function status() {
    if (active && typeof cameraClient.isActive === 'function' && cameraClient.isActive() !== true) {
      active = false;
      lens = null;
      deviceId = null;
    }
    let device = null;
    try {
      device = await phoneBridge.detect();
    } catch {
      device = null;
    }
    return Object.freeze({
      active,
      lens,
      devices: Object.freeze(device ? [Object.freeze({ deviceId: device.deviceId, model: device.model })] : []),
    });
  }

  async function start(request) {
    const { deviceId: requestedDeviceId, lens: requestedLens } = exactShape(request, ['deviceId', 'lens'], 'camera_ui_request_invalid');
    if (!DEVICE_ID.test(requestedDeviceId ?? '') || !LENSES.has(requestedLens)) throw new TypeError('camera_ui_request_invalid');
    await cameraClient.start({ deviceId: requestedDeviceId, lens: requestedLens });
    active = true;
    lens = requestedLens;
    deviceId = requestedDeviceId;
    return Object.freeze({ active, lens, deviceId });
  }

  async function stop() {
    const result = await cameraClient.stop();
    active = false;
    lens = null;
    deviceId = null;
    return result;
  }

  async function switchLens(request) {
    const { lens: requestedLens } = exactShape(request, ['lens'], 'camera_ui_request_invalid');
    if (!LENSES.has(requestedLens)) throw new TypeError('camera_ui_request_invalid');
    if (!active || !deviceId) throw new Error('camera_stream_inactive');
    await cameraClient.stop();
    await cameraClient.start({ deviceId, lens: requestedLens });
    lens = requestedLens;
    return Object.freeze({ active, lens, deviceId });
  }

  async function nextPreviewFrame() {
    if (!active) throw new Error('camera_stream_inactive');
    if (now() - lastPreviewAtMs < PREVIEW_MIN_INTERVAL_MS) throw new Error('camera_preview_rate_limited');
    lastPreviewAtMs = now();
    const { value: frame, done } = await cameraClient.frames().next();
    if (done || !frame) return null;
    return Object.freeze({ jpegBase64: frame.jpeg.toString('base64'), capturedAtMs: frame.capturedAtMs, sequence: frame.sequence });
  }

  async function enroll(request) {
    const { identityId, samples } = exactShape(request, ['identityId', 'samples'], 'camera_ui_request_invalid');
    if (!IDENTITY_ID.test(identityId ?? '') || !Array.isArray(samples)) throw new TypeError('camera_ui_request_invalid');
    return faceRecognizer.enroll({ identityId, samples: samples.map(decodeSample) });
  }

  async function deleteProfile(request) {
    const { identityId } = exactShape(request, ['identityId'], 'camera_ui_request_invalid');
    if (!IDENTITY_ID.test(identityId ?? '')) throw new TypeError('camera_ui_request_invalid');
    return profileStore.delete(identityId);
  }

  return Object.freeze({ status, start, stop, switchLens, nextPreviewFrame, enroll, deleteProfile });
}
