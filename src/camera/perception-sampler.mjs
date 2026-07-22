export function createPerceptionSampler() {
  let latest = null;
  let dropped = 0;

  return Object.freeze({
    offer(frame) {
      if (!frame || !Number.isSafeInteger(frame.sequence) || frame.sequence < 1) {
        throw new TypeError('perception_frame_invalid');
      }
      if (latest !== null) dropped += 1;
      latest = frame;
    },
    takeLatest() {
      const frame = latest;
      latest = null;
      return Object.freeze({ frame, dropped });
    },
  });
}
