import { classifyChannelCapability } from './channel-policy.mjs';
import { classifyCapabilityBase } from './policy.mjs';

function matchesPattern(value, pattern) {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) {
    return String(value).toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase());
  }
  return String(value).toLowerCase() === String(pattern).toLowerCase();
}

function confirmationKey(request) {
  return [
    request.sessionId,
    request.capability,
    request.resource ?? '',
    request.digest,
  ].join('\u0000');
}

function decision(value) {
  return Object.freeze(value);
}

export function createCapabilityBroker({
  clock = Date.now,
  grants = [],
  onConfirmationRequired = () => {},
  telegramCapabilities = [],
} = {}) {
  if (!Array.isArray(telegramCapabilities) || telegramCapabilities.some((capability) => (
    typeof capability !== 'string'
    || !(capability.startsWith('mail.') || capability === 'home.read' || capability === 'home.low_risk')
  ))) throw new TypeError('telegram_capabilities_invalid');
  const configuredTelegramCapabilities = Object.freeze([...telegramCapabilities]);
  const confirmations = new Map();
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  function grantConfirmation(request) {
    if (!request.sessionId || !request.capability || !request.digest || !request.expiresAt) {
      throw new TypeError('invalid_confirmation');
    }
    confirmations.set(confirmationKey(request), Date.parse(request.expiresAt));
  }

  async function authorize(request) {
    const base = classifyCapabilityBase(request);
    if (base.decision === 'deny') return decision(base);

    const channel = classifyChannelCapability(request, { telegramCapabilities: configuredTelegramCapabilities });
    if (channel.decision === 'deny') return decision(channel);

    const activeGrants = grants.filter((grant) => (
      grant.sessionId === request.sessionId
      && Date.parse(grant.expiresAt) > now()
    ));
    const capabilityGrants = activeGrants.filter((grant) => (
      grant.capabilities.some((pattern) => matchesPattern(request.capability, pattern))
      && grant.effects.includes(request.effect)
    ));
    if (!capabilityGrants.length) {
      return decision({ decision: 'deny', reason: 'session_grant' });
    }

    const resourceAllowed = capabilityGrants.some((grant) => (
      grant.resources.some((pattern) => matchesPattern(request.resource ?? '', pattern))
    ));
    if (!resourceAllowed) {
      return decision({ decision: 'deny', reason: 'resource_scope' });
    }

    const requiresConfirmation = base.decision === 'confirm' || channel.decision === 'confirm';
    if (!requiresConfirmation) return decision({ decision: 'allow', reason: 'authorized' });

    const key = confirmationKey(request);
    const expiresAt = confirmations.get(key);
    if (expiresAt && expiresAt > now()) {
      confirmations.delete(key);
      return decision({ decision: 'allow', reason: 'confirmation_consumed' });
    }
    confirmations.delete(key);
    await onConfirmationRequired({ request: Object.freeze({ ...request }) });
    return decision({ decision: 'confirm', reason: 'confirmation_required' });
  }

  return Object.freeze({ authorize, grantConfirmation });
}
