import { describe, expect, it } from 'vitest';
import { createPhysicalDeviceRegistry } from '../src/devices/physical-device-registry.mjs';

describe('physical Android device registry', () => {
  it('merges USB and LAN endpoints only through one verified signed device identity', () => {
    const registry = createPhysicalDeviceRegistry();
    registry.observeEndpoint({
      deviceId: 'huawei-primary', verified: true,
      endpoint: { endpointId: 'usb-huawei', type: 'usb', serial: 'HUAWEITESTSERIAL' },
    });
    registry.observeEndpoint({
      deviceId: 'huawei-primary', verified: true,
      endpoint: { endpointId: 'lan-192-168-1-16', type: 'lan', serial: '192.168.1.16:5555' },
    });

    expect(registry.resolveOwnerDevice()).toMatchObject({ deviceId: 'huawei-primary' });
    expect(registry.resolveOwnerDevice().endpoints.map(({ type }) => type)).toEqual(['usb', 'lan']);
    expect(registry.preferredTransport('huawei-primary')).toMatchObject({ type: 'usb' });
    registry.markUnhealthy('huawei-primary', 'usb-huawei');
    expect(registry.preferredTransport('huawei-primary')).toMatchObject({ type: 'lan' });
  });

  it('marks endpoints unhealthy once they stop appearing in a fresh scan (e.g. USB unplugged) instead of preferring a dead serial forever', () => {
    const registry = createPhysicalDeviceRegistry();
    registry.observeEndpoint({
      deviceId: 'huawei-primary', verified: true,
      endpoint: { endpointId: 'usb-huawei', type: 'usb', serial: 'HUAWEITESTSERIAL' },
    });
    registry.observeEndpoint({
      deviceId: 'huawei-primary', verified: true,
      endpoint: { endpointId: 'lan-192-168-1-16', type: 'lan', serial: '192.168.1.16:5555' },
    });
    expect(registry.preferredTransport('huawei-primary')).toMatchObject({ type: 'usb' });

    // A fresh `adb devices -l` scan only sees the LAN serial now — USB was unplugged.
    registry.pruneAbsentEndpoints(['192.168.1.16:5555']);

    expect(registry.preferredTransport('huawei-primary')).toMatchObject({ type: 'lan' });
  });

  it('leaves every endpoint untouched when the scan still sees all of them', () => {
    const registry = createPhysicalDeviceRegistry();
    registry.observeEndpoint({
      deviceId: 'huawei-primary', verified: true,
      endpoint: { endpointId: 'usb-huawei', type: 'usb', serial: 'HUAWEITESTSERIAL' },
    });
    registry.pruneAbsentEndpoints(['HUAWEITESTSERIAL']);
    expect(registry.preferredTransport('huawei-primary')).toMatchObject({ type: 'usb' });
  });

  it('rejects unverified endpoints and fails closed for a second physical identity', () => {
    const registry = createPhysicalDeviceRegistry();
    expect(() => registry.observeEndpoint({
      deviceId: 'huawei-primary', verified: false,
      endpoint: { endpointId: 'usb-a', type: 'usb', serial: 'A' },
    })).toThrow('device_identity_unverified');
    registry.observeEndpoint({
      deviceId: 'huawei-primary', verified: true,
      endpoint: { endpointId: 'usb-a', type: 'usb', serial: 'A' },
    });
    registry.observeEndpoint({
      deviceId: 'second-phone', verified: true,
      endpoint: { endpointId: 'usb-b', type: 'usb', serial: 'B' },
    });
    expect(() => registry.resolveOwnerDevice()).toThrow('physical_device_ambiguous');
  });
});
