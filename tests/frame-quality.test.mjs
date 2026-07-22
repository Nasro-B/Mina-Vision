import { describe, expect, it } from 'vitest';
import { assessFrameQuality, decideLensFlip, frameStatsFromGrayscale } from '../src/perception/frame-quality.mjs';

describe('assessFrameQuality', () => {
  it('flags a near-black frame as unusable (too dark)', () => {
    expect(assessFrameQuality({ meanLuminance: 4, detailVariance: 900 })).toEqual({ usable: false, reason: 'too_dark' });
  });

  it('flags a flat / out-of-focus frame as unusable (too blurry)', () => {
    expect(assessFrameQuality({ meanLuminance: 120, detailVariance: 5 })).toEqual({ usable: false, reason: 'too_blurry' });
  });

  it('accepts a bright, detailed frame', () => {
    expect(assessFrameQuality({ meanLuminance: 120, detailVariance: 900 })).toEqual({ usable: true, reason: 'ok' });
  });

  it('checks darkness before blur (a black frame is reported dark, not blurry)', () => {
    expect(assessFrameQuality({ meanLuminance: 2, detailVariance: 1 })).toEqual({ usable: false, reason: 'too_dark' });
  });

  it('honours custom thresholds', () => {
    expect(assessFrameQuality({ meanLuminance: 30, detailVariance: 900 }, { blackThreshold: 40 }))
      .toEqual({ usable: false, reason: 'too_dark' });
    expect(assessFrameQuality({ meanLuminance: 120, detailVariance: 200 }, { blurThreshold: 100 }))
      .toEqual({ usable: true, reason: 'ok' });
  });

  it('rejects non-numeric stats defensively', () => {
    expect(assessFrameQuality({ meanLuminance: Number.NaN, detailVariance: 900 })).toEqual({ usable: false, reason: 'invalid_stats' });
    expect(assessFrameQuality({})).toEqual({ usable: false, reason: 'invalid_stats' });
  });
});

describe('decideLensFlip', () => {
  it('flips front → back once when the frame is unusable and no flip was tried yet', () => {
    const decision = decideLensFlip({ assessment: { usable: false, reason: 'too_dark' }, currentLens: 'front', alreadyFlipped: false });
    expect(decision).toEqual({ flip: true, toLens: 'back' });
  });

  it('flips back → front too', () => {
    const decision = decideLensFlip({ assessment: { usable: false, reason: 'too_blurry' }, currentLens: 'back', alreadyFlipped: false });
    expect(decision).toEqual({ flip: true, toLens: 'front' });
  });

  it('never flips more than once (avoids ping-pong)', () => {
    const decision = decideLensFlip({ assessment: { usable: false, reason: 'too_dark' }, currentLens: 'back', alreadyFlipped: true });
    expect(decision).toEqual({ flip: false, toLens: 'back' });
  });

  it('never flips a usable frame', () => {
    const decision = decideLensFlip({ assessment: { usable: true, reason: 'ok' }, currentLens: 'front', alreadyFlipped: false });
    expect(decision).toEqual({ flip: false, toLens: 'front' });
  });
});

describe('frameStatsFromGrayscale', () => {
  it('computes mean and variance from a raw grayscale byte array', () => {
    const pixels = Uint8Array.from([0, 0, 0, 0]);
    expect(frameStatsFromGrayscale(pixels)).toEqual({ meanLuminance: 0, detailVariance: 0 });
  });

  it('reports high variance for a half-black half-white field', () => {
    const pixels = Uint8Array.from([0, 0, 255, 255]);
    const stats = frameStatsFromGrayscale(pixels);
    expect(stats.meanLuminance).toBeCloseTo(127.5, 1);
    expect(stats.detailVariance).toBeGreaterThan(10_000);
  });

  it('throws on an empty buffer rather than dividing by zero', () => {
    expect(() => frameStatsFromGrayscale(new Uint8Array(0))).toThrow('frame_pixels_required');
  });
});
