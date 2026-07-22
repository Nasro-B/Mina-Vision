import { describe, expect, it, vi } from 'vitest';
import { createSharedCameraRuntime } from '../src/camera/shared-camera-runtime.mjs';

describe('shared camera runtime', () => {
  it('uses one real client for UI events, preview polling, and clean stop', async () => {
    let releaseFrame;
    const frame = {
      jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      mimeType: 'image/jpeg',
      capturedAtMs: 1_752_000_000_000,
      sequence: 1,
      lens: 'front',
      rotation: 0,
      width: 2,
      height: 2,
    };
    const client = {
      start: vi.fn(async () => ({ active: true })),
      stop: vi.fn(async () => ({ stopped: true })),
      frames: vi.fn(() => (async function* frames() {
        yield frame;
        await new Promise((resolve) => { releaseFrame = resolve; });
      })()),
    };
    const onFrame = vi.fn();
    const runtime = createSharedCameraRuntime({
      phoneBridge: { detect: vi.fn(async () => ({ deviceId: 'huawei-1', model: 'MAR-LX1A' })) },
      createClient: vi.fn(() => client),
      onFrame,
    });

    await expect(runtime.start({ deviceId: 'huawei-1', lens: 'front' }))
      .resolves.toMatchObject({ active: true, deviceId: 'huawei-1', lens: 'front' });
    await vi.waitFor(() => expect(onFrame).toHaveBeenCalledWith(frame));
    await expect(runtime.frames().next()).resolves.toMatchObject({ value: frame, done: false });
    expect(runtime.latestFrame()).toMatchObject({ sequence: 1 });

    await expect(runtime.stop()).resolves.toEqual({ stopped: true });
    releaseFrame?.();
    expect(client.stop).toHaveBeenCalledTimes(1);
  });
});
