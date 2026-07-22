import { describe, expect, it } from 'vitest';
import { createPerceptionSampler } from '../src/camera/perception-sampler.mjs';

describe('perception sampler', () => {
  it('keeps only the newest frame during overload and records dropped frames', () => {
    const sampler = createPerceptionSampler();
    sampler.offer({ sequence: 1 });
    sampler.offer({ sequence: 2 });
    sampler.offer({ sequence: 3 });

    expect(sampler.takeLatest()).toEqual({ frame: { sequence: 3 }, dropped: 2 });
    expect(sampler.takeLatest()).toEqual({ frame: null, dropped: 2 });
  });
});
