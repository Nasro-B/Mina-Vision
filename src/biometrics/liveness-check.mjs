const MIN_FRAMES = 6;
const MIN_DURATION_MS = 600;
const MAX_DURATION_MS = 8_000;
const MIN_YAW_RANGE = 0.08;
const LANDMARK_KEYS = ['leftEye', 'leftMouth', 'nose', 'rightEye', 'rightMouth'].join(',');

function isPoint(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function validateFrame(frame) {
  if (!frame || !Number.isSafeInteger(frame.capturedAtMs) || frame.capturedAtMs < 1
    || !frame.landmarks || Object.keys(frame.landmarks).sort().join(',') !== LANDMARK_KEYS
    || !Object.values(frame.landmarks).every(isPoint)) {
    throw new TypeError('liveness_frame_invalid');
  }
}

function yawProxy(landmarks) {
  const midEyeX = (landmarks.rightEye[0] + landmarks.leftEye[0]) / 2;
  const interEyeDistance = Math.abs(landmarks.leftEye[0] - landmarks.rightEye[0]);
  if (interEyeDistance < 1) throw new TypeError('liveness_frame_invalid');
  return (landmarks.nose[0] - midEyeX) / interEyeDistance;
}

/**
 * Heuristic multi-frame presence signal derived only from YuNet's 5-point landmarks
 * (no eyelid contour is available from that model, so this deliberately checks head-turn
 * motion and capture-time consistency, not blink). This is never identity proof.
 */
export function evaluateLiveness({ frames } = {}) {
  if (!Array.isArray(frames) || frames.length < 1) throw new TypeError('liveness_frames_invalid');
  frames.forEach(validateFrame);

  const failures = [];
  if (frames.length < MIN_FRAMES) failures.push('insufficient_frames');

  let monotonic = true;
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index].capturedAtMs <= frames[index - 1].capturedAtMs) monotonic = false;
  }
  if (!monotonic) failures.push('non_monotonic_timestamps');

  const durationMs = frames.at(-1).capturedAtMs - frames[0].capturedAtMs;
  if (durationMs < MIN_DURATION_MS) failures.push('duration_too_short');
  if (durationMs > MAX_DURATION_MS) failures.push('duration_too_long');

  const yaws = frames.map((frame) => yawProxy(frame.landmarks));
  const yawRange = Math.max(...yaws) - Math.min(...yaws);
  const motionDetected = yawRange >= MIN_YAW_RANGE;
  if (!motionDetected) failures.push('no_motion_detected');

  return Object.freeze({
    signal: 'presence_signal',
    passed: failures.length === 0,
    reasons: Object.freeze([...failures, ...(motionDetected ? ['head_turn_detected'] : [])]),
  });
}
