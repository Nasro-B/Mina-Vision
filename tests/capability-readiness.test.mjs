import { describe, expect, it } from 'vitest';
import { capabilityFromReadiness } from '../src/diagnostics/capability-readiness.mjs';

describe('capability readiness mapper', () => {
  it('reports an unimplemented capability as unavailable without trusting a probe', () => {
    expect(capabilityFromReadiness({
      id: 'home.google',
      implemented: false,
      probe: { ready: true },
    })).toEqual({
      id: 'home.google',
      status: 'unavailable',
      reason: 'not_implemented',
      evidence: ['unit'],
    });
  });

  it('reports implemented Android support as degraded when no device is authorized', () => {
    expect(capabilityFromReadiness({
      id: 'computer_use.android',
      implemented: true,
      probe: { ready: false, reason: 'no_authorized_android_device' },
    })).toEqual({
      id: 'computer_use.android',
      status: 'degraded',
      reason: 'no_authorized_android_device',
      evidence: ['unit', 'health'],
    });
  });

  it('reports LM Studio as available only after a successful health probe', () => {
    expect(capabilityFromReadiness({
      id: 'models.lm_studio',
      implemented: true,
      probe: { ready: true },
    })).toEqual({
      id: 'models.lm_studio',
      status: 'available',
      reason: null,
      evidence: ['unit', 'health'],
    });
  });

  it('uses a stable fallback when a failed probe has no safe reason', () => {
    expect(capabilityFromReadiness({
      id: 'mail',
      implemented: true,
      probe: { ready: false },
    })).toMatchObject({ status: 'degraded', reason: 'runtime_probe_not_ready' });
  });
});
