import { describe, expect, it } from 'vitest';
import { createInferenceModePolicy } from '../src/routing/inference-mode-policy.mjs';

const candidates = [
  { id: 'cloud-a', locality: 'cloud', network: 'internet' },
  { id: 'local-loopback', locality: 'local', network: 'loopback' },
  { id: 'local-inline', locality: 'local', network: 'none' },
];

describe('inference mode policy', () => {
  it('orders auto cloud-first, local-first locally and local-only without cloud', () => {
    const policy = createInferenceModePolicy();
    expect(policy.filter(candidates, { mode: 'auto', offline: false }).map(({ id }) => id))
      .toEqual(['cloud-a', 'local-loopback', 'local-inline']);
    expect(policy.filter(candidates, { mode: 'local-first', offline: false }).map(({ id }) => id))
      .toEqual(['local-loopback', 'local-inline', 'cloud-a']);
    expect(policy.filter(candidates, { mode: 'local-only', offline: false }).map(({ id }) => id))
      .toEqual(['local-loopback', 'local-inline']);
  });

  it('offline rejects LAN and Internet routes but permits local loopback', () => {
    const policy = createInferenceModePolicy();
    expect(policy.filter(candidates, { mode: 'auto', offline: true }).map(({ id }) => id))
      .toEqual(['local-loopback', 'local-inline']);
    expect(() => policy.filter(candidates, { mode: 'invalid', offline: false })).toThrow('inference_mode_invalid');
  });

  it('keeps local loopback providers available while offline', () => {
    const policy = createInferenceModePolicy();
    const candidates = [
      { id: 'embedded', locality: 'local', network: 'none' },
      { id: 'lm-studio', locality: 'local', network: 'loopback' },
      { id: 'lan', locality: 'local', network: 'lan' },
      { id: 'cloud', locality: 'cloud', network: 'internet' },
    ];

    expect(policy.filter(candidates, { mode: 'local-only', offline: true }).map(({ id }) => id))
      .toEqual(['embedded', 'lm-studio']);
  });
});
