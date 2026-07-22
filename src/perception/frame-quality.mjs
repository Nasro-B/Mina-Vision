// Pure frame-quality decision layer for "si la vision est floue ou noire, retourne la caméra".
// The pixel-stats extraction is separated from the decision so the whole flip logic is testable with
// plain numbers, and the (heavier) JPEG decode can be wired via an injected extractor in the app.

const DEFAULT_BLACK_THRESHOLD = 16; // mean 8-bit luminance at/below this reads as a dark/covered lens
const DEFAULT_BLUR_THRESHOLD = 60; // luminance variance below this reads as flat / out-of-focus

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function assessFrameQuality(
  { meanLuminance, detailVariance } = {},
  { blackThreshold = DEFAULT_BLACK_THRESHOLD, blurThreshold = DEFAULT_BLUR_THRESHOLD } = {},
) {
  if (!isFiniteNumber(meanLuminance) || !isFiniteNumber(detailVariance)) {
    return { usable: false, reason: 'invalid_stats' };
  }
  if (meanLuminance <= blackThreshold) return { usable: false, reason: 'too_dark' };
  if (detailVariance < blurThreshold) return { usable: false, reason: 'too_blurry' };
  return { usable: true, reason: 'ok' };
}

// Flips at most once (alreadyFlipped guard) so a genuinely dark room / covered lens can't ping-pong
// the camera forever. The caller tracks alreadyFlipped for the current streaming session.
export function decideLensFlip({ assessment, currentLens, alreadyFlipped } = {}) {
  const otherLens = currentLens === 'back' ? 'front' : 'back';
  if (assessment?.usable === false && alreadyFlipped !== true) {
    return { flip: true, toLens: otherLens };
  }
  return { flip: false, toLens: currentLens };
}

// Single-pass mean + variance over an 8-bit grayscale buffer (variance = detail/contrast proxy).
export function frameStatsFromGrayscale(pixels) {
  if (!pixels || pixels.length === 0) throw new Error('frame_pixels_required');
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 1) sum += pixels[i];
  const meanLuminance = sum / pixels.length;
  let squaredError = 0;
  for (let i = 0; i < pixels.length; i += 1) {
    const delta = pixels[i] - meanLuminance;
    squaredError += delta * delta;
  }
  return { meanLuminance, detailVariance: squaredError / pixels.length };
}
