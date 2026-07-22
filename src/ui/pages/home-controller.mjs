function publicDevice(device) {
  return Object.freeze({
    deviceId: device.deviceId, displayName: device.displayName, aliases: Object.freeze([...device.aliases]),
    roomId: device.roomId, roomName: device.roomName, deviceClass: device.deviceClass,
    capabilities: Object.freeze([...device.capabilities]), riskTier: device.riskTier,
    confirmationPolicy: device.confirmationPolicy, enabled: device.enabled,
    bindings: Object.freeze(device.bindings.map((binding) => Object.freeze({ connectorId: binding.connectorId, capabilities: binding.capabilities }))),
  });
}

export function createHomeController({ registry, service, connectors = {}, audit } = {}) {
  if (!registry?.list || !registry?.resolve || !registry?.update || !service?.execute || !service?.getReceipt
    || typeof audit !== 'function') {
    throw new TypeError('home_controller_dependencies_required');
  }

  async function connectorHealth() {
    const entries = await Promise.all(Object.entries(connectors).map(async ([id, connector]) => [id, await connector.health()]));
    return Object.freeze(Object.fromEntries(entries));
  }

  async function requestPermission(connectorId) {
    const connector = connectors[connectorId];
    if (typeof connector?.requestPermission !== 'function') return Object.freeze({ supported: false });
    return connector.requestPermission();
  }

  async function discover(connectorId) {
    const connector = connectors[connectorId];
    if (typeof connector?.discoverEntities !== 'function') return Object.freeze({ supported: false });
    return connector.discoverEntities();
  }

  function list() {
    return registry.list().map(publicDevice);
  }

  function resolve(request) {
    return registry.resolve(request);
  }

  async function editDevice({ deviceId, patch, confirmedLocally } = {}) {
    if (confirmedLocally !== true) throw new Error('home_device_edit_confirmation_required');
    const updated = registry.update(deviceId, patch);
    audit({ type: 'home_device_edited', deviceId, patch });
    return publicDevice(updated);
  }

  async function execute(request) {
    return service.execute(request);
  }

  function auditHistory(commandId) {
    return service.getReceipt(commandId);
  }

  return Object.freeze({
    connectorHealth, requestPermission, discover, list, resolve, editDevice, execute, auditHistory,
  });
}
