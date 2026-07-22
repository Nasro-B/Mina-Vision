import { describe, expect, it } from 'vitest';
import { evaluateLiveness } from '../src/biometrics/liveness-check.mjs';

function landmarks({ noseOffset = 0 } = {}) {
  return {
    rightEye: [40, 60],
    leftEye: [80, 60],
    nose: [60 + noseOffset, 90],
    rightMouth: [45, 120],
    leftMouth: [75, 120],
  };
}

function frameSeries({ count = 8, startMs = 1_752_000_000_000, stepMs = 200, turn = true } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    capturedAtMs: startMs + index * stepMs,
    landmarks: landmarks({ noseOffset: turn ? (index - count / 2) * 3 : 0 }),
  }));
}

describe('multi-frame liveness presence signal', () => {
  it('never labels its result as identity proof, only a presence signal', () => {
    const result = evaluateLiveness({ frames: frameSeries() });
    expect(result.signal).toBe('presence_signal');
    expect(result).not.toHaveProperty('identityVerified');
    expect(result).not.toHaveProperty('identity');
  });

  it('passes when enough frames show a clear head turn across a plausible duration', () => {
    const result = evaluateLiveness({ frames: frameSeries({ count: 8, stepMs: 200, turn: true }) });
    expect(result.passed).toBe(true);
    expect(result.reasons).toContain('head_turn_detected');
  });

  it('rejects fewer than six frames as insufficient for a challenge signal', () => {
    const result = evaluateLiveness({ frames: frameSeries({ count: 5 }) });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('insufficient_frames');
  });

  it('rejects frames captured with non-increasing timestamps', () => {
    const frames = frameSeries({ count: 6 });
    frames[3] = { ...frames[3], capturedAtMs: frames[2].capturedAtMs };
    const result = evaluateLiveness({ frames });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('non_monotonic_timestamps');
  });

  it('rejects a burst captured too quickly to be a real multi-frame challenge', () => {
    const result = evaluateLiveness({ frames: frameSeries({ count: 8, stepMs: 10, turn: true }) });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('duration_too_short');
  });

  it('rejects a series stretched far beyond a plausible single challenge', () => {
    const result = evaluateLiveness({ frames: frameSeries({ count: 8, stepMs: 2_000, turn: true }) });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('duration_too_long');
  });

  it('rejects a static series with no detectable head motion, guarding against a still photo', () => {
    const result = evaluateLiveness({ frames: frameSeries({ count: 8, stepMs: 200, turn: false }) });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('no_motion_detected');
  });

  it('throws on a malformed frame instead of silently skipping it', () => {
    const frames = frameSeries({ count: 6 });
    frames[2] = { capturedAtMs: frames[2].capturedAtMs, landmarks: { rightEye: [1, 2] } };
    expect(() => evaluateLiveness({ frames })).toThrow('liveness_frame_invalid');
  });
});
