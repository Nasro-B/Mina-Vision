const ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const RISKS = new Set(['low', 'medium', 'high', 'blocked']);
const RISK_ORDER = Object.freeze({ low: 0, medium: 1, high: 2, blocked: 3 });
const LOW_RISK_CLASSES = new Set(['light']);
const MEDIUM_RISK_CLASSES = new Set(['plug', 'switch', 'tv', 'blind', 'blinds', 'cover', 'fan', 'thermostat', 'climate']);
const BLOCKED_RISK_CLASSES = new Set([
  'lock', 'garage', 'gate', 'alarm', 'camera', 'oven', 'hob', 'high_power_heater',
  'water_heater', 'water_valve', 'gas_valve', 'valve',
]);

const normalize = (value) => String(value ?? '').normalize('NFKD')
  .replace(/\p{M}/gu, '').trim().toLocaleLowerCase('fr-FR').replace(/\s+/gu, ' ');

function normalizeDeviceClass(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('fr-FR').replace(/[\s-]+/gu, '_') : '';
}

function maxRisk(...risks) {
  return risks.reduce((current, risk) => (RISK_ORDER[risk] > RISK_ORDER[current] ? risk : current), 'low');
}

function riskFloor(deviceClass) {
  if (LOW_RISK_CLASSES.has(deviceClass) || deviceClass === 'scene') return 'low';
  if (MEDIUM_RISK_CLASSES.has(deviceClass)) return 'medium';
  return 'blocked';
}

function isScene(device) {
  return normalizeDeviceClass(device?.deviceClass) === 'scene';
}

function validateDevice(device) {
  if (!ID.test(device?.deviceId ?? '') || typeof device.displayName !== 'string'
    || typeof device.deviceClass !== 'string' || !normalizeDeviceClass(device.deviceClass)
    || !Array.isArray(device.aliases) || !Array.isArray(device.capabilities) || !Array.isArray(device.bindings)
    || (device.riskTier !== undefined && !RISKS.has(device.riskTier)) || typeof device.enabled !== 'boolean'
    || (device.sceneMembers !== undefined && (!Array.isArray(device.sceneMembers)
      || device.sceneMembers.some((memberId) => !ID.test(memberId))))) {
    throw new TypeError('smart_home_device_invalid');
  }
  const riskTier = maxRisk(riskFloor(normalizeDeviceClass(device.deviceClass)), device.riskTier ?? 'low');
  return Object.freeze({ ...structuredClone(device), riskTier });
}

function resolveSceneRisks(entries) {
  const byId = new Map(entries.map((device) => [device.deviceId, device]));
  const cache = new Map();

  function resolveRisk(device, ancestry = new Set()) {
    if (!isScene(device)) return device.riskTier;
    if (cache.has(device.deviceId)) return cache.get(device.deviceId);
    if (ancestry.has(device.deviceId) || !Array.isArray(device.sceneMembers) || device.sceneMembers.length === 0) {
      return 'blocked';
    }
    const nextAncestry = new Set(ancestry).add(device.deviceId);
    let inheritedRisk = device.riskTier;
    for (const memberId of device.sceneMembers) {
      const member = byId.get(memberId);
      if (!member) return 'blocked';
      inheritedRisk = maxRisk(inheritedRisk, resolveRisk(member, nextAncestry));
    }
    cache.set(device.deviceId, inheritedRisk);
    return inheritedRisk;
  }

  return entries.map((device) => (isScene(device)
    ? Object.freeze({ ...device, riskTier: resolveRisk(device) })
    : device));
}

const candidate = (device) => Object.freeze({
  deviceId: device.deviceId,
  displayName: device.displayName,
  roomName: device.roomName,
  deviceClass: device.deviceClass,
});

const EDITABLE_FIELDS = new Set(['aliases', 'riskTier', 'confirmationPolicy', 'enabled']);

export function createSmartHomeRegistry({ devices = [] } = {}) {
  let entries = resolveSceneRisks(devices.map(validateDevice));
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
    entries = resolveSceneRisks(entries.map((device, position) => (position === index ? updated : device)));
    return entries[index];
  }

  return Object.freeze({ resolve, get, update, list: () => Object.freeze([...entries]) });
}
