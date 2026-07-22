import { registerSkillsSandboxIpc } from './skills-sandbox-ipc.mjs';
import { registerSettingsIpc } from './settings-ipc.mjs';
import { registerAnalyticsIpc } from './analytics-ipc.mjs';
import { registerMailIpc } from './mail-ipc.mjs';
import { registerHomeIpc } from './home-ipc.mjs';
import { registerCameraIpc } from './camera-ipc.mjs';
import { registerAutomationIpc } from './automation-ipc.mjs';
import { registerRecoveryIpc } from './recovery-ipc.mjs';
import { registerEvaluationIpc } from './evaluation-ipc.mjs';
import { registerPersonalIpc } from './personal-ipc.mjs';
import { registerDocumentIpc } from './document-ipc.mjs';
import { registerEmergencyIpc } from './emergency-ipc.mjs';
import { registerApprovalIpc } from './approval-ipc.mjs';
import { registerConnectorIpc } from './connector-ipc.mjs';
import { registerPersonalityIpc } from './personality-ipc.mjs';

// Channels registered directly in src/ui/main.mjs (session/core, memory/research, voice) that are
// not yet behind their own controller+register module. Listed here so the allowlist snapshot below
// covers the whole application, not just the newer domains. Consolidating them into dedicated
// controllers is tracked separately; this list is the single source of truth for what main.mjs may
// legally call `ipcMain.handle`/`ipcMain.on` for outside the domain modules below.
export const CORE_CHANNELS = Object.freeze([
  'mina:status', 'mina:start', 'mina:dental', 'mina:stop',
  'mina:phone-detect', 'mina:phone-camera', 'mina:phone-camera-stop',
  'mina:sms-send-confirmed', 'mina:phone-sync-messages',
  'mina:voice-start', 'mina:voice-stop', 'mina:voice-input',
  'mina:session-state', 'mina:claims', 'mina:grounding-status',
  'memory.status', 'memory.initialize', 'memory.unlock', 'memory.lock', 'memory.search', 'memory.proposeForget',
  'research.readFile', 'research.readWeb',
]);

const DOMAIN_REGISTRARS = Object.freeze({
  skillsSandbox: registerSkillsSandboxIpc,
  settings: registerSettingsIpc,
  analytics: registerAnalyticsIpc,
  mail: registerMailIpc,
  home: registerHomeIpc,
  camera: registerCameraIpc,
  automation: registerAutomationIpc,
  recovery: registerRecoveryIpc,
  evaluation: registerEvaluationIpc,
  personal: registerPersonalIpc,
  document: registerDocumentIpc,
  emergency: registerEmergencyIpc,
  approval: registerApprovalIpc,
  connector: registerConnectorIpc,
  personality: registerPersonalityIpc,
});

function assertValidChannel(channel, seen) {
  if (typeof channel !== 'string' || channel.length < 1) throw new TypeError('ipc_channel_invalid');
  if (channel.includes('*') || channel.includes('?')) throw new Error(`ipc_channel_wildcard_forbidden:${channel}`);
  if (seen.has(channel)) throw new Error(`ipc_channel_duplicate:${channel}`);
  seen.add(channel);
}

export function registerMinaIpc({
  ipcMain, controllers = {}, coreChannels = CORE_CHANNELS,
  isValidSender = () => true, maxPayloadBytes = null,
} = {}) {
  if (!ipcMain?.handle) throw new TypeError('register_ipc_dependencies_required');
  if (typeof isValidSender !== 'function') throw new TypeError('register_ipc_sender_validator_invalid');
  const seen = new Set();
  const registered = [];

  // Both guards are opt-in (default no-ops) so every existing caller/test keeps identical behavior;
  // a caller that knows its main window can pass isValidSender to reject a non-main-frame sender,
  // and/or maxPayloadBytes as a generic backstop against an oversized IPC payload.
  function guarded(channel, handler) {
    return async (event, ...args) => {
      if (!isValidSender(event)) throw new Error(`ipc_sender_frame_rejected:${channel}`);
      if (maxPayloadBytes !== null) {
        const size = Buffer.byteLength(JSON.stringify(args[0] ?? null) ?? '', 'utf8');
        if (size > maxPayloadBytes) throw new Error(`ipc_payload_too_large:${channel}`);
      }
      return handler(event, ...args);
    };
  }

  for (const channel of coreChannels) {
    assertValidChannel(channel, seen);
    registered.push(channel);
  }

  const trackingIpcMain = Object.freeze({
    handle: (channel, handler) => {
      assertValidChannel(channel, seen);
      registered.push(channel);
      return ipcMain.handle(channel, guarded(channel, handler));
    },
    on: (channel, handler) => {
      assertValidChannel(channel, seen);
      registered.push(channel);
      return ipcMain.on?.(channel, guarded(channel, handler));
    },
  });

  for (const [key, registrar] of Object.entries(DOMAIN_REGISTRARS)) {
    const controller = controllers[key];
    if (!controller) continue;
    registrar({ ipcMain: trackingIpcMain, controller });
  }

  return Object.freeze({ channels: Object.freeze([...registered]) });
}
