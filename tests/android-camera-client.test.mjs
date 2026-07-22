import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAndroidCameraClient, validateAndroidCameraFrame } from '../src/camera/android-camera-client.mjs';

function framed(values) {
  return Buffer.from(values.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('|'), 'utf8');
}

function signedFrame({ sequence = 1, capturedAtMs = 2_000, jpeg = Buffer.from('ffd8ff0102ffd9', 'hex') } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicKeySpkiBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const sha256 = createHash('sha256').update(jpeg).digest('hex');
  const challenge = [
    'mina-camera-frame-v1', 'cam-0123456789abcdef0123456789abcdef', sequence, capturedAtMs,
    'FRONT', 90, 640, 480, 'image/jpeg', 75, sha256,
  ].join('|');
  const deviceId = 'huawei-primary';
  return {
    envelope: {
      version: 1,
      file: `frame-${sequence}.jpg`,
      sessionId: 'cam-0123456789abcdef0123456789abcdef',
      sequence,
      capturedAtMs,
      lens: 'front',
      rotation: 90,
      width: 640,
      height: 480,
      mimeType: 'image/jpeg',
      jpegQuality: 75,
      sha256,
      deviceId,
      publicKeySpkiBase64,
      challenge,
      signatureBase64: sign('sha256', framed([deviceId, publicKeySpkiBase64, challenge]), privateKey).toString('base64'),
    },
    jpeg,
  };
}

describe('android camera client', () => {
  it('accepts a fresh signed frame from the expected paired Huawei', () => {
    expect(validateAndroidCameraFrame(signedFrame(), {
      expectedDeviceId: 'huawei-primary', nowMs: 2_500, previousSequence: 0,
    })).toMatchObject({ sequence: 1, width: 640, height: 480 });
    expect(validateAndroidCameraFrame(signedFrame({ capturedAtMs: 9_000 }), {
      expectedDeviceId: 'huawei-primary', nowMs: 2_500, previousSequence: 0,
    })).toMatchObject({ sequence: 1 });
  });

  it('rejects replay, stale data, wrong device and malformed JPEG', () => {
    expect(() => validateAndroidCameraFrame(signedFrame(), {
      expectedDeviceId: 'huawei-primary', nowMs: 2_500, previousSequence: 1,
    })).toThrow('camera_frame_replay');
    expect(() => validateAndroidCameraFrame(signedFrame(), {
      expectedDeviceId: 'huawei-primary', nowMs: 8_001, previousSequence: 0,
    })).toThrow('camera_frame_expired');
    expect(() => validateAndroidCameraFrame(signedFrame(), {
      expectedDeviceId: 'another-device', nowMs: 2_500, previousSequence: 0,
    })).toThrow('camera_device_mismatch');
    expect(() => validateAndroidCameraFrame(signedFrame({ jpeg: Buffer.from('not-jpeg') }), {
      expectedDeviceId: 'huawei-primary', nowMs: 2_500, previousSequence: 0,
    })).toThrow('camera_jpeg_invalid');
  });

  it('starts, yields frames and cancels the Android stream', async () => {
    const phoneBridge = {
      detect: vi.fn(async () => ({ deviceId: 'huawei-primary' })),
      startSensorCameraStream: vi.fn(async () => ({ sessionRequested: true })),
      touchCameraKeepalive: vi.fn(async () => {}),
      readLatestCameraFrame: vi.fn(async () => signedFrame()),
      stopSensorCameraStream: vi.fn(async () => {}),
    };
    const client = createAndroidCameraClient({ phoneBridge, now: () => 2_500, wait: async () => {} });

    await client.start({ deviceId: 'huawei-primary', lens: 'front', maxFps: 5 });
    const iterator = client.frames();
    await expect(iterator.next()).resolves.toMatchObject({ value: { sequence: 1, lens: 'front' }, done: false });
    await client.stop();
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    expect(phoneBridge.stopSensorCameraStream).toHaveBeenCalledTimes(1);
  });
});
