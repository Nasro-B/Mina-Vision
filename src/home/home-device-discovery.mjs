import { devicesFromHomeAssistantEntities } from './home-assistant-discovery.mjs';

function safeReason(error) {
  return String(error?.message ?? error).replace(/\s+/gu, '_').slice(0, 80);
}

export async function discoverSmartHomeDevices({ connectors = {} } = {}) {
  const devices = [];
  const notes = [];

  const homeAssistant = connectors['home-assistant'];
  if (typeof homeAssistant?.discoverEntities === 'function') {
    try {
      devices.push(...devicesFromHomeAssistantEntities(await homeAssistant.discoverEntities()));
    } catch (error) {
      notes.push(`home_assistant_discovery_failed:${safeReason(error)}`);
    }
  }

  return Object.freeze({
    devices: Object.freeze(devices),
    notes: Object.freeze(notes),
  });
}
