import { describe, expect, it } from 'vitest';
import { createPhysicalDeviceRegistry } from '../src/devices/physical-device-registry.mjs';
import { createPhoneFleet } from '../src/devices/phone-fleet.mjs';
import { reconcileFleet } from '../src/devices/phone-fleet-sync.mjs';

const HUAWEI = 'device-huawei-signed';
const SAMSUNG = 'device-samsung-signed';

function usb(serial, model = 'MAR-LX1A') {
  return { endpointId: `usb:${serial}`, type: 'usb', serial, model, healthy: true };
}
function lan(serial, model = 'SM-A715F') {
  return { endpointId: `lan:${serial}`, type: 'lan', serial, model, healthy: true };
}

function setup() {
  const registry = createPhysicalDeviceRegistry();
  const fleet = createPhoneFleet({ now: () => 1 });
  return { registry, fleet };
}

describe('phone-fleet-sync (Phase 3 flotte ADB)', () => {
  it('reconcilie deux téléphones (Huawei USB, Samsung Wi-Fi) dans la flotte', () => {
    const { registry, fleet } = setup();
    registry.observeEndpoint({ deviceId: HUAWEI, verified: true, endpoint: usb('HW123') });
    registry.observeEndpoint({ deviceId: SAMSUNG, verified: true, endpoint: lan('192.168.1.11:5555') });

    reconcileFleet({ fleet, registry });
    const list = fleet.list();
    expect(list).toHaveLength(2);
    expect(fleet.require(HUAWEI)).toMatchObject({ transport: 'usb', healthy: true });
    expect(fleet.require(SAMSUNG)).toMatchObject({ transport: 'lan', healthy: true });
  });

  it('conserve la priorité USB quand un même appareil a USB et Wi-Fi (§16, Phase 3)', () => {
    const { registry, fleet } = setup();
    registry.observeEndpoint({ deviceId: HUAWEI, verified: true, endpoint: usb('HW123') });
    registry.observeEndpoint({ deviceId: HUAWEI, verified: true, endpoint: lan('10.0.0.5:5555') });
    reconcileFleet({ fleet, registry });
    expect(fleet.require(HUAWEI).transport).toBe('usb');
  });

  it('bascule USB→Wi-Fi sans changer le deviceId quand l’USB disparaît', () => {
    const { registry, fleet } = setup();
    registry.observeEndpoint({ deviceId: HUAWEI, verified: true, endpoint: usb('HW123') });
    registry.observeEndpoint({ deviceId: HUAWEI, verified: true, endpoint: lan('10.0.0.5:5555') });
    reconcileFleet({ fleet, registry });
    expect(fleet.require(HUAWEI).transport).toBe('usb');

    // L'USB est débranché : seul le serial Wi-Fi reste présent au scan ADB.
    registry.pruneAbsentEndpoints(['10.0.0.5:5555']);
    reconcileFleet({ fleet, registry });
    const device = fleet.require(HUAWEI);
    expect(device.transport).toBe('lan');
    expect(device.healthy).toBe(true);
    expect(fleet.list()).toHaveLength(1); // même deviceId, pas un doublon
  });

  it('un téléphone absent devient non sain mais N’EST PAS oublié (continuité + reconnexion)', () => {
    const { registry, fleet } = setup();
    registry.observeEndpoint({ deviceId: HUAWEI, verified: true, endpoint: usb('HW123') });
    registry.observeEndpoint({ deviceId: SAMSUNG, verified: true, endpoint: lan('192.168.1.11:5555') });
    reconcileFleet({ fleet, registry });

    // Le Samsung quitte le réseau : plus aucun de ses serials présent.
    registry.pruneAbsentEndpoints(['HW123']);
    reconcileFleet({ fleet, registry });
    expect(fleet.require(SAMSUNG).healthy).toBe(false);
    expect(fleet.require(HUAWEI).healthy).toBe(true); // l'autre continue de servir
    expect(fleet.list()).toHaveLength(2); // gardé pour la reconnexion

    // Reconnexion : le même deviceId redevient sain, jamais une nouvelle identité.
    registry.observeEndpoint({ deviceId: SAMSUNG, verified: true, endpoint: lan('192.168.1.11:5555') });
    reconcileFleet({ fleet, registry });
    expect(fleet.require(SAMSUNG).healthy).toBe(true);
    expect(fleet.list()).toHaveLength(2);
  });

  it('porte Phase 3 : deux téléphones sains → une action sans cible explicite est REFUSÉE', () => {
    const { registry, fleet } = setup();
    registry.observeEndpoint({ deviceId: HUAWEI, verified: true, endpoint: usb('HW123') });
    registry.observeEndpoint({ deviceId: SAMSUNG, verified: true, endpoint: lan('192.168.1.11:5555') });
    reconcileFleet({ fleet, registry });
    expect(() => fleet.require(null)).toThrow('phone_fleet_device_ambiguous');
    expect(fleet.require(SAMSUNG).deviceId).toBe(SAMSUNG); // cible explicite = OK
  });
});
