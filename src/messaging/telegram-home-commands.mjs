import { normalizeSmartHomeIntent } from '../home/intent-normalizer.mjs';

const STATUS_CMD = '/home status';
const HOME_CMD = /^\/home\s+(.+?)\s+(on|off|status)$/iu;
const COMMAND_TTL_MS = 30_000;

const ACTION_BY_VERB = Object.freeze({ on: 'turn_on', off: 'turn_off', status: 'read_state' });
const REPLY_BY_STATE = Object.freeze({
  state_confirmed: 'État confirmé.',
  accepted_by_provider: 'Commande acceptée, état non encore confirmé.',
  awaiting_confirmation: 'Action moyenne risque : brouillon en attente de confirmation locale sur le PC.',
  denied: 'Action refusée.',
  clarification_required: 'Cible ambiguë : plusieurs appareils correspondent, précisez la pièce.',
  target_not_found: 'Appareil introuvable.',
  connector_unavailable: 'Connecteur indisponible.',
  failed: 'Échec de la commande.',
});

function stripQuotes(value) {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
}

export function createTelegramHomeCommands({
  isOwner,
  homeService,
  homeRegistry,
  audit,
  createCommandId = () => crypto.randomUUID(),
  now = Date.now,
} = {}) {
  if (typeof isOwner !== 'function' || !homeService?.execute || !homeRegistry?.list || typeof audit !== 'function') {
    throw new TypeError('telegram_home_commands_dependencies_required');
  }

  async function handle({ sender, body } = {}) {
    if (typeof body !== 'string' || !body.trim().startsWith('/home')) return null;
    if (!(await isOwner(sender))) {
      audit({ type: 'telegram_home_command_denied_identity', sender });
      return Object.freeze({ reply: ['Commande refusée.'] });
    }
    const trimmed = body.trim();

    if (trimmed === STATUS_CMD) {
      const devices = homeRegistry.list().filter((device) => device.enabled);
      const text = devices.length
        ? devices.map((device) => `${device.displayName} (${device.roomName ?? '?'})`).join('\n')
        : 'Aucun appareil.';
      return Object.freeze({ reply: [text] });
    }

    const match = trimmed.match(HOME_CMD);
    if (!match) return Object.freeze({ reply: ['Commande /home inconnue.'] });
    const [, rawTarget, verb] = match;
    const action = ACTION_BY_VERB[verb.toLowerCase()];

    let intent;
    try {
      intent = normalizeSmartHomeIntent({
        action, targetText: stripQuotes(rawTarget), sourceChannel: 'telegram', sessionId: String(sender),
      });
    } catch {
      return Object.freeze({ reply: ['Commande /home invalide.'] });
    }

    const receipt = await homeService.execute({
      commandId: createCommandId(), intent, expiresAt: now() + COMMAND_TTL_MS,
    });
    if (receipt.state === 'awaiting_confirmation' || receipt.state === 'denied') {
      audit({ type: 'telegram_home_command_gated', sender, deviceId: receipt.deviceId, state: receipt.state, reason: receipt.reason });
    }
    return Object.freeze({ reply: [REPLY_BY_STATE[receipt.state] ?? `État: ${receipt.state}.`] });
  }

  return Object.freeze({ handle });
}
