export function classifyAdbEndpoint(serial) {
  if (typeof serial !== 'string' || !/^[A-Za-z0-9._:-]+$/u.test(serial)) throw new TypeError('adb_endpoint_invalid');
  return /^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/u.test(serial) ? 'lan' : 'usb';
}

export function createAndroidTransport({ registry, verifyDeviceIdentity } = {}) {
  if (!registry?.observeEndpoint || typeof verifyDeviceIdentity !== 'function') {
    throw new TypeError('android_transport_dependencies_required');
  }
  async function observe(endpoint) {
    const identity = await verifyDeviceIdentity(endpoint);
    return registry.observeEndpoint({
      deviceId: identity?.deviceId,
      verified: identity?.verified === true,
      endpoint: {
        endpointId: `${endpoint.type}-${endpoint.serial}`,
        type: endpoint.type,
        serial: endpoint.serial,
        model: endpoint.model ?? null,
      },
    });
  }
  return Object.freeze({ observe });
}
