const ACTIONS = new Set([
  'turn_on', 'turn_off', 'set_brightness', 'set_color',
  'set_temperature', 'set_position', 'run_scene', 'read_state',
]);
const CHANNELS = new Set(['local_ui', 'voice', 'telegram', 'firebase']);
const ID = /^[A-Za-z0-9._:-]{1,160}$/u;

function requiredText(value, code, max = 160) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > max || value.includes('\0')) {
    throw new TypeError(code);
  }
  return value.trim();
}

function desiredState(action, value) {
  if (action === 'turn_on') return Object.freeze({ on: true });
  if (action === 'turn_off') return Object.freeze({ on: false });
  if (action === 'read_state') return Object.freeze({});
  if (action === 'run_scene') return Object.freeze({ run: true });
  if (action === 'set_brightness' || action === 'set_position') {
    if (!Number.isInteger(value) || value < 0 || value > 100) throw new TypeError('smart_home_value_invalid');
    return Object.freeze({ [action === 'set_brightness' ? 'brightness' : 'position']: value });
  }
  if (action === 'set_temperature') {
    if (!Number.isFinite(value) || value < -50 || value > 60) throw new TypeError('smart_home_value_invalid');
    return Object.freeze({ temperature: value });
  }
  if (action === 'set_color') {
    if ((typeof value !== 'string' || value.length < 1 || value.length > 80) && (!value || typeof value !== 'object')) {
      throw new TypeError('smart_home_value_invalid');
    }
    return Object.freeze({ color: structuredClone(value) });
  }
  throw new TypeError('smart_home_action_invalid');
}

export function normalizeSmartHomeIntent(raw = {}) {
  const allowed = new Set(['action', 'targetText', 'roomText', 'value', 'sourceChannel', 'sessionId']);
  if (Object.keys(raw).some((key) => !allowed.has(key)) || !ACTIONS.has(raw.action)) {
    throw new TypeError('smart_home_action_invalid');
  }
  if (!CHANNELS.has(raw.sourceChannel) || !ID.test(raw.sessionId ?? '')) {
    throw new TypeError('smart_home_source_invalid');
  }
  const targetText = requiredText(raw.targetText, 'smart_home_target_invalid');
  const roomText = raw.roomText === undefined ? undefined : requiredText(raw.roomText, 'smart_home_room_invalid');
  const desired = desiredState(raw.action, raw.value);
  return Object.freeze({
    action: raw.action,
    targetText,
    ...(roomText ? { roomText } : {}),
    ...(raw.value !== undefined ? { value: structuredClone(raw.value) } : {}),
    desiredState: desired,
    sourceChannel: raw.sourceChannel,
    sessionId: raw.sessionId,
  });
}
