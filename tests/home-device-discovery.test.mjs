import { describe, expect, it, vi } from 'vitest';
import { discoverSmartHomeDevices } from '../src/home/home-device-discovery.mjs';

describe('discoverSmartHomeDevices', () => {
  it('hydrates Mina devices from a configured Home Assistant connector', async () => {
    const connector = {
      discoverEntities: vi.fn(async () => [
        { entityId: 'light.salon', domain: 'light', friendlyName: 'Lumière salon' },
      ]),
    };

    const result = await discoverSmartHomeDevices({ connectors: { 'home-assistant': connector } });

    expect(result.devices).toEqual([
      expect.objectContaining({ deviceId: 'ha:light.salon', displayName: 'Lumière salon' }),
    ]);
    expect(result.notes).toEqual([]);
  });

  it('keeps boot honest when discovery fails', async () => {
    const result = await discoverSmartHomeDevices({
      connectors: { 'home-assistant': { discoverEntities: vi.fn(async () => { throw new Error('offline'); }) } },
    });

    expect(result.devices).toEqual([]);
    expect(result.notes).toEqual(['home_assistant_discovery_failed:offline']);
  });
});
