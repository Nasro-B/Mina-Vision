import { describe, expect, it } from 'vitest';
import { createSmartHomeRegistry } from '../src/home/registry.mjs';
import { devicesFromHomeAssistantEntities } from '../src/home/home-assistant-discovery.mjs';

describe('devicesFromHomeAssistantEntities', () => {
  it('maps supported Home Assistant entities to Mina devices with executable bindings', () => {
    const devices = devicesFromHomeAssistantEntities([
      { entityId: 'light.salon', domain: 'light', friendlyName: 'Lumière salon' },
      { entityId: 'switch.prise_tv', domain: 'switch', friendlyName: 'Prise TV' },
      { entityId: 'lock.porte', domain: 'lock', friendlyName: 'Porte' },
    ]);

    expect(devices).toEqual([
      expect.objectContaining({
        deviceId: 'ha:light.salon',
        displayName: 'Lumière salon',
        deviceClass: 'light',
        capabilities: ['read_state', 'turn_on', 'turn_off', 'set_brightness', 'set_color'],
        bindings: [expect.objectContaining({ connectorId: 'home-assistant', entityId: 'light.salon' })],
      }),
      expect.objectContaining({
        deviceId: 'ha:switch.prise_tv',
        deviceClass: 'switch',
        riskTier: 'medium',
        capabilities: ['read_state', 'turn_on', 'turn_off'],
      }),
    ]);
    expect(JSON.stringify(devices)).not.toMatch(/token|secret|password/i);
  });

  it('produces devices accepted by the smart-home registry', () => {
    const registry = createSmartHomeRegistry({
      devices: devicesFromHomeAssistantEntities([
        { entityId: 'light.chambre', domain: 'light', friendlyName: 'Plafonnier chambre' },
      ]),
    });

    expect(registry.resolve({ targetText: 'Plafonnier chambre' })).toMatchObject({
      status: 'resolved',
      device: expect.objectContaining({ deviceId: 'ha:light.chambre' }),
    });
  });
});
