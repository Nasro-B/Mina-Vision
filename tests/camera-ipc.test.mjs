import { describe, expect, it, vi } from 'vitest';
import { createCameraController } from '../src/ui/pages/camera-controller.mjs';
import { registerCameraIpc } from '../src/ui/ipc/camera-ipc.mjs';

function harness(overrides = {}) {
  let now = 0;
  const dependencies = {
    phoneBridge: { detect: vi.fn(async () => ({ deviceId: 'dev-huawei-1', model: 'MAR-LX1A' })) },
    cameraClient: {
      start: vi.fn(async () => ({ active: true })),
      stop: vi.fn(async () => ({ stopped: true })),
      frames: vi.fn(function frames() {
        return (async function* generator() {
          yield { jpeg: Buffer.from('jpeg-bytes'), capturedAtMs: 1_752_000_000_000, sequence: 1 };
        })();
      }),
    },
    faceRecognizer: { enroll: vi.fn(async ({ identityId, samples }) => ({ enrolled: true, identityId, samples: samples.length })) },
    profileStore: { delete: vi.fn(async () => true) },
    now: () => now,
    ...overrides,
  };
  return { dependencies, advance: (ms) => { now += ms; }, controller: createCameraController(dependencies) };
}

const EIGHT_SAMPLES = Array.from({ length: 8 }, (_, index) => ({
  imageBase64: Buffer.from([index + 1]).toString('base64'),
  angle: ['front', 'front', 'front', 'left', 'left', 'left', 'right', 'right'][index],
}));

describe('camera controller: device list and permission-derived state', () => {
  it('reports no active stream and the detected Huawei device before start', async () => {
    const { controller } = harness();
    await expect(controller.status()).resolves.toEqual({
      active: false, lens: null, devices: [{ deviceId: 'dev-huawei-1', model: 'MAR-LX1A' }],
    });
  });

  it('reports an empty device list when no phone is authorized, never throwing from status', async () => {
    const { controller } = harness({ phoneBridge: { detect: vi.fn(async () => { throw new Error('unauthorized'); }) } });
    await expect(controller.status()).resolves.toEqual({ active: false, lens: null, devices: [] });
  });
});

describe('camera controller: start, stop, and visible active state', () => {
  it('starts the sensor stream for a validated device and lens, then reflects the active state', async () => {
    const { controller, dependencies } = harness();
    await expect(controller.start({ deviceId: 'dev-huawei-1', lens: 'front' }))
      .resolves.toEqual({ active: true, lens: 'front', deviceId: 'dev-huawei-1' });
    expect(dependencies.cameraClient.start).toHaveBeenCalledWith({ deviceId: 'dev-huawei-1', lens: 'front' });
    await expect(controller.status()).resolves.toMatchObject({ active: true, lens: 'front' });
  });

  it('rejects an unknown lens value instead of forwarding it to the client', async () => {
    const { controller } = harness();
    await expect(controller.start({ deviceId: 'dev-huawei-1', lens: 'zoom' })).rejects.toThrow('camera_ui_request_invalid');
  });

  it('stops the stream and clears the active state', async () => {
    const { controller, dependencies } = harness();
    await controller.start({ deviceId: 'dev-huawei-1', lens: 'front' });
    await expect(controller.stop()).resolves.toEqual({ stopped: true });
    expect(dependencies.cameraClient.stop).toHaveBeenCalledTimes(1);
    await expect(controller.status()).resolves.toMatchObject({ active: false, lens: null });
  });

  it('drops stale active state when the underlying CameraX stream has failed', async () => {
    let runtimeActive = true;
    const { controller } = harness({
      cameraClient: {
        start: vi.fn(async () => { runtimeActive = true; return { active: true }; }),
        stop: vi.fn(async () => { runtimeActive = false; return { stopped: true }; }),
        frames: vi.fn(() => (async function* frames() {})()),
        isActive: () => runtimeActive,
      },
    });
    await controller.start({ deviceId: 'dev-huawei-1', lens: 'front' });
    runtimeActive = false;

    await expect(controller.status()).resolves.toMatchObject({ active: false, lens: null });
  });
});

describe('camera controller: lens switch', () => {
  it('stops and restarts on the same device when switching lens while streaming', async () => {
    const { controller, dependencies } = harness();
    await controller.start({ deviceId: 'dev-huawei-1', lens: 'front' });

    await expect(controller.switchLens({ lens: 'back' })).resolves.toEqual({ active: true, lens: 'back', deviceId: 'dev-huawei-1' });
    expect(dependencies.cameraClient.stop).toHaveBeenCalledTimes(1);
    expect(dependencies.cameraClient.start).toHaveBeenLastCalledWith({ deviceId: 'dev-huawei-1', lens: 'back' });
  });

  it('refuses to switch lens when no stream is active', async () => {
    const { controller } = harness();
    await expect(controller.switchLens({ lens: 'back' })).rejects.toThrow('camera_stream_inactive');
  });
});

describe('camera controller: bounded preview cadence', () => {
  it('serves a preview frame as base64 without a raw Buffer leaking into the response', async () => {
    const { controller } = harness();
    await controller.start({ deviceId: 'dev-huawei-1', lens: 'front' });

    const frame = await controller.nextPreviewFrame();
    expect(frame).toEqual({ jpegBase64: Buffer.from('jpeg-bytes').toString('base64'), capturedAtMs: 1_752_000_000_000, sequence: 1 });
  });

  it('rate-limits preview polling to at most two frames per second', async () => {
    const { controller, advance } = harness();
    await controller.start({ deviceId: 'dev-huawei-1', lens: 'front' });

    await controller.nextPreviewFrame();
    await expect(controller.nextPreviewFrame()).rejects.toThrow('camera_preview_rate_limited');
    advance(500);
    await expect(controller.nextPreviewFrame()).resolves.not.toBeNull();
  });

  it('refuses to serve a preview frame while the stream is inactive', async () => {
    const { controller } = harness();
    await expect(controller.nextPreviewFrame()).rejects.toThrow('camera_stream_inactive');
  });
});

describe('camera controller: enrollment and profile deletion', () => {
  it('decodes base64 samples and delegates enrollment to the face recognizer', async () => {
    const { controller, dependencies } = harness();
    await expect(controller.enroll({ identityId: 'nasro', samples: EIGHT_SAMPLES }))
      .resolves.toEqual({ enrolled: true, identityId: 'nasro', samples: 8 });
    const forwarded = dependencies.faceRecognizer.enroll.mock.calls[0][0];
    expect(forwarded.identityId).toBe('nasro');
    expect(Buffer.isBuffer(forwarded.samples[0].image)).toBe(true);
  });

  it('rejects an enrollment request carrying an unknown angle label', async () => {
    const { controller } = harness();
    const badSamples = EIGHT_SAMPLES.map((sample, index) => (index === 0 ? { ...sample, angle: 'up' } : sample));
    await expect(controller.enroll({ identityId: 'nasro', samples: badSamples })).rejects.toThrow('camera_ui_request_invalid');
  });

  it('deletes an enrolled profile by identity id', async () => {
    const { controller, dependencies } = harness();
    await expect(controller.deleteProfile({ identityId: 'nasro' })).resolves.toBe(true);
    expect(dependencies.profileStore.delete).toHaveBeenCalledWith('nasro');
  });

  it('rejects a malformed identity id instead of forwarding it to storage', async () => {
    const { controller, dependencies } = harness();
    await expect(controller.deleteProfile({ identityId: 'Nasro Berkoun' })).rejects.toThrow('camera_ui_request_invalid');
    expect(dependencies.profileStore.delete).not.toHaveBeenCalled();
  });
});

describe('camera controller has no path to sensitive authorization', () => {
  it('never accepts a capability broker dependency, so recognition cannot unlock anything', () => {
    expect(createCameraController.length).toBeLessThanOrEqual(1);
    const { controller } = harness();
    expect(controller.capabilityBroker).toBeUndefined();
    expect(controller.confirm).toBeUndefined();
  });
});

describe('camera IPC allowlist', () => {
  it('registers exactly the named camera channels and validates every payload', async () => {
    const handlers = new Map();
    const ipcMain = { handle: vi.fn((channel, handler) => handlers.set(channel, handler)) };
    const { controller } = harness();
    registerCameraIpc({ ipcMain, controller });

    expect([...handlers.keys()]).toEqual([
      'mina:camera:status',
      'mina:camera:start',
      'mina:camera:stop',
      'mina:camera:switch-lens',
      'mina:camera:preview-frame',
      'mina:camera:enroll',
      'mina:camera:delete-profile',
    ]);
    await expect(handlers.get('mina:camera:start')({}, { deviceId: 'dev-huawei-1', lens: 'front', extra: true }))
      .rejects.toThrow('camera_ui_request_invalid');
  });
});
