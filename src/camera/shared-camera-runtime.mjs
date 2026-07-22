import { createAndroidCameraClient } from './android-camera-client.mjs';

const FRAME_WAIT_TIMEOUT_MS = 15_000;

export function createSharedCameraRuntime({
  phoneBridge,
  createClient = ({ phoneBridge: bridge }) => createAndroidCameraClient({ phoneBridge: bridge }),
  onFrame = () => {},
  onStatus = () => {},
} = {}) {
  if (!phoneBridge?.detect || typeof createClient !== 'function') {
    throw new TypeError('shared_camera_dependencies_required');
  }

  let client = null;
  let streamTask = null;
  let latest = null;
  const frameWaiters = new Set();

  const publishFrame = (frame) => {
    latest = frame;
    for (const waiter of frameWaiters) waiter.resolve(frame);
    frameWaiters.clear();
    onFrame(frame);
  };

  const rejectWaiters = (error) => {
    for (const waiter of frameWaiters) waiter.reject(error);
    frameWaiters.clear();
  };

  const waitForFrame = () => {
    if (latest) return Promise.resolve(latest);
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (frame) => { clearTimeout(waiter.timer); resolve(frame); },
        reject: (error) => { clearTimeout(waiter.timer); reject(error); },
        timer: null,
      };
      waiter.timer = setTimeout(() => {
        frameWaiters.delete(waiter);
        reject(new Error('camera_stream_start_timeout'));
      }, FRAME_WAIT_TIMEOUT_MS);
      frameWaiters.add(waiter);
    });
  };

  async function start({ deviceId, lens = 'front', maxFps = 5 } = {}) {
    if (client) return Object.freeze({ active: true, started: false, deviceId, lens });
    const detected = await phoneBridge.detect();
    if (detected.deviceId !== deviceId) throw new Error('camera_device_mismatch');
    const nextClient = createClient({ phoneBridge });
    await nextClient.start({ deviceId, lens, maxFps });
    client = nextClient;
    latest = null;
    onStatus({ state: 'starting', deviceId, lens });
    streamTask = (async () => {
      try {
        for await (const frame of nextClient.frames()) {
          if (client !== nextClient) break;
          publishFrame(frame);
          onStatus({ state: 'streaming', sequence: frame.sequence, deviceId, lens: frame.lens });
        }
      } catch (error) {
        if (client === nextClient) {
          client = null;
          latest = null;
          rejectWaiters(error);
          onStatus({ state: 'error', error: String(error?.message ?? error).slice(0, 200) });
          await nextClient.stop().catch(() => {});
        }
      }
    })();
    streamTask.catch(() => {});
    return Object.freeze({ active: true, started: true, deviceId, lens });
  }

  async function stop() {
    const current = client;
    client = null;
    latest = null;
    rejectWaiters(new Error('camera_stream_inactive'));
    if (!current) return Object.freeze({ stopped: false });
    const result = await current.stop();
    onStatus({ state: 'stopped' });
    return result;
  }

  function frames() {
    return (async function* nextSharedFrame() {
      yield await waitForFrame();
    })();
  }

  const latestFrame = () => (latest ? Object.freeze({ ...latest, jpeg: Buffer.from(latest.jpeg) }) : null);

  return Object.freeze({ start, stop, frames, latestFrame, isActive: () => Boolean(client) });
}
