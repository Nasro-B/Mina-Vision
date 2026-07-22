import { describe, expect, it, vi } from 'vitest';
import { createHealthService } from '../src/diagnostics/health-service.mjs';

function harness(overrides = {}) {
  const probes = {
    cloudKeys: vi.fn(async () => ({ ready: false, reason: 'MINA_KEYS_ROTATED or provider keys absent' })),
    lmStudio: vi.fn(async () => ({ ready: false, reason: 'lm_studio_closed' })),
    androidTransport: vi.fn(async () => ({ ready: true, transports: ['usb'] })),
    wifi: vi.fn(async () => ({ ready: false, reason: 'wifi_unavailable' })),
    googleHomeSdk: vi.fn(async () => ({ ready: false, reason: 'google_home_sdk_unavailable' })),
    mailAccounts: vi.fn(async () => ({ ready: false, reason: 'mail_unconfigured' })),
    firebase: vi.fn(async () => ({ ready: false, reason: 'firebase_unconfigured', optional: true })),
    ...overrides,
  };
  return { service: createHealthService({ probes }), probes };
}

describe('health service: read-only bounded probes, no secrets', () => {
  it('runs every registered probe and returns a redacted report', async () => {
    const { service } = harness();
    const report = await service.runOnce();
    expect(report.cloudKeys).toEqual({ ready: false, reason: 'MINA_KEYS_ROTATED or provider keys absent' });
    expect(report.androidTransport).toEqual({ ready: true, transports: ['usb'] });
    expect(JSON.stringify(report)).not.toMatch(/api[_-]?key|token|secret|password/iu);
  });

  it('marks optional integrations (Firebase) as unconfigured rather than a false failure', async () => {
    const { service } = harness();
    const report = await service.runOnce();
    expect(report.firebase).toMatchObject({ ready: false, optional: true });
  });

  it('never lets one probe throwing break the rest of the report', async () => {
    const { service } = harness({ wifi: vi.fn(async () => { throw new Error('probe_crashed'); }) });
    const report = await service.runOnce();
    expect(report.wifi).toEqual({ ready: false, reason: 'probe_crashed' });
    expect(report.androidTransport.ready).toBe(true);
  });

  it('reports overall readiness as false when any required (non-optional) probe is not ready', async () => {
    const { service } = harness();
    const report = await service.runOnce();
    expect(report.summary.allRequiredReady).toBe(false);
    expect(report.summary.notReady).toEqual(expect.arrayContaining(['cloudKeys', 'lmStudio', 'wifi', 'googleHomeSdk', 'mailAccounts']));
  });

  it('reports overall readiness as true once every required probe is ready, optional ones ignored', async () => {
    const { service } = harness({
      cloudKeys: vi.fn(async () => ({ ready: true })),
      lmStudio: vi.fn(async () => ({ ready: true })),
      wifi: vi.fn(async () => ({ ready: true })),
      googleHomeSdk: vi.fn(async () => ({ ready: true })),
      mailAccounts: vi.fn(async () => ({ ready: true })),
    });
    const report = await service.runOnce();
    expect(report.summary.allRequiredReady).toBe(true);
    expect(report.summary.notReady).toEqual([]);
  });
});
