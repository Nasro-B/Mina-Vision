const ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const RISKS = new Set(['low', 'medium', 'high', 'blocked']);

const normalize = (value) => String(value ?? '').normalize('NFKD')
  .replace(/\p{M}/gu, '').trim().toLocaleLowerCase('fr-FR').replace(/\s+/gu, ' ');

function validateDevice(device) {
  if (!ID.test(device?.deviceId ?? '') || typeof device.displayName !== 'string'
    || !Array.isArray(device.aliases) || !Array.isArray(device.capabilities) || !Array.isArray(device.bindings)
    || !RISKS.has(device.riskTier) || typeof device.enabled !== 'boolean') {
    throw new TypeError('smart_home_device_invalid');
  }
  return Object.freeze(structuredClone(device));
}

const candidate = (device) => Object.freeze({
  deviceId: device.deviceId,
  displayName: device.displayName,
  roomName: device.roomName,
  deviceClass: device.deviceClass,
});

const EDITABLE_FIELDS = new Set(['aliases', 'riskTier', 'confirmationPolicy', 'enabled']);

export function createSmartHomeRegistry({ devices = [] } = {}) {
  let entries = devices.map(validateDevice);
  if (new Set(entries.map(({ deviceId }) => deviceId)).size !== entries.length) {
    throw new Error('smart_home_device_duplicate');
  }

  function resolve({ targetText, roomText } = {}) {
    const target = normalize(targetText);
    const room = normalize(roomText);
    if (!target) throw new TypeError('smart_home_target_invalid');
    const matches = entries.filter((device) => device.enabled
      && [device.displayName, ...device.aliases].some((name) => normalize(name) === target)
      && (!room || [device.roomId, device.roomName].some((name) => normalize(name) === room)));
    if (matches.length === 0) return Object.freeze({ status: 'not_found' });
    if (matches.length > 1) return Object.freeze({ status: 'ambiguous', candidates: Object.freeze(matches.map(candidate)) });
    return Object.freeze({ status: 'resolved', device: matches[0] });
  }

  const get = (deviceId) => entries.find((device) => device.deviceId === deviceId) ?? null;

  function update(deviceId, patch = {}) {
    const index = entries.findIndex((device) => device.deviceId === deviceId);
    if (index === -1) throw new Error('smart_home_device_not_found');
    if (Object.keys(patch).some((key) => !EDITABLE_FIELDS.has(key))) throw new TypeError('smart_home_device_patch_invalid');
    const updated = validateDevice({ ...entries[index], ...patch });
    entries = entries.map((device, position) => (position === index ? updated : device));
    return updated;
  }

  return Object.freeze({ resolve, get, update, list: () => Object.freeze([...entries]) });
}
