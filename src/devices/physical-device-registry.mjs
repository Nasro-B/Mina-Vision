const ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const TRANSPORT_ORDER = Object.freeze({ usb: 0, lan: 1, firebase: 2 });

function publicDevice(record) {
  const endpoints = [...record.endpoints.values()]
    .sort((left, right) => (TRANSPORT_ORDER[left.type] - TRANSPORT_ORDER[right.type])
      || left.endpointId.localeCompare(right.endpointId))
    .map((endpoint) => Object.freeze({ ...endpoint }));
  return Object.freeze({ deviceId: record.deviceId, endpoints: Object.freeze(endpoints) });
}

export function createPhysicalDeviceRegistry() {
  const devices = new Map();
  const endpointOwners = new Map();

  function observeEndpoint({ deviceId, verified, endpoint } = {}) {
    if (verified !== true) throw new Error('device_identity_unverified');
    if (!ID.test(deviceId ?? '') || !endpoint || !ID.test(endpoint.endpointId ?? '')
      || !['usb', 'lan', 'firebase'].includes(endpoint.type) || !ID.test(endpoint.serial ?? '')) {
      throw new TypeError('physical_endpoint_invalid');
    }
    const existingOwner = endpointOwners.get(endpoint.endpointId);
    if (existingOwner && existingOwner !== deviceId) throw new Error('physical_endpoint_identity_conflict');
    const record = devices.get(deviceId) ?? { deviceId, endpoints: new Map() };
    record.endpoints.set(endpoint.endpointId, Object.freeze({
      endpointId: endpoint.endpointId,
      type: endpoint.type,
      serial: endpoint.serial,
      model: endpoint.model ?? null,
      healthy: endpoint.healthy !== false,
    }));
    devices.set(deviceId, record);
    endpointOwners.set(endpoint.endpointId, deviceId);
    return publicDevice(record);
  }

  function resolveOwnerDevice(deviceId = null) {
    if (deviceId !== null) {
      const record = devices.get(deviceId);
      if (!record) throw new Error('physical_device_unknown');
      return publicDevice(record);
    }
    if (devices.size !== 1) throw new Error('physical_device_ambiguous');
    return publicDevice(devices.values().next().value);
  }

  function preferredTransport(deviceId) {
    const device = resolveOwnerDevice(deviceId);
    const endpoint = device.endpoints.find((candidate) => candidate.healthy);
    if (!endpoint) throw new Error('physical_device_transport_unavailable');
    return endpoint;
  }

  function markUnhealthy(deviceId, endpointId) {
    const record = devices.get(deviceId);
    const endpoint = record?.endpoints.get(endpointId);
    if (!endpoint) throw new Error('physical_endpoint_unknown');
    record.endpoints.set(endpointId, Object.freeze({ ...endpoint, healthy: false }));
    return publicDevice(record);
  }

  // A fresh `adb devices -l` scan only reports endpoints currently reachable — anything observed
  // before but absent now (USB unplugged, phone left the LAN) is stale. Without this, preferredTransport
  // keeps returning a dead serial forever (USB always sorts first and defaults healthy:true), so every
  // camera/SMS action silently fails against a device that no longer exists.
  function pruneAbsentEndpoints(currentSerials) {
    const present = new Set(currentSerials ?? []);
    for (const record of devices.values()) {
      for (const [endpointId, endpoint] of record.endpoints) {
        if (!present.has(endpoint.serial) && endpoint.healthy) {
          record.endpoints.set(endpointId, Object.freeze({ ...endpoint, healthy: false }));
        }
      }
    }
  }

  return Object.freeze({ observeEndpoint, resolveOwnerDevice, preferredTransport, markUnhealthy, pruneAbsentEndpoints });
}
