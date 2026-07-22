import { classifyChannelCapability } from '../safety/channel-policy.mjs';

const CHANNELS = Object.freeze(['local', 'voice', 'sms', 'telegram']);
const IDENTITY_KIND_BY_CHANNEL = Object.freeze({
  sms: 'phone', telegram: 'telegram', local: 'local_owner', voice: 'local_owner',
});

export function normalizeTurnInput({ channel, identityValue, text, capability, workSessionId } = {}) {
  if (!CHANNELS.includes(channel)) throw new TypeError('channel_router_channel_invalid');
  if (typeof text !== 'string' || text.length === 0 || text.length > 8_000) throw new TypeError('channel_router_text_invalid');
  const identityKind = IDENTITY_KIND_BY_CHANNEL[channel];
  if ((channel === 'sms' || channel === 'telegram') && (typeof identityValue !== 'string' || identityValue.length === 0)) {
    throw new TypeError('channel_router_identity_required');
  }
  return Object.freeze({
    channel,
    identity: Object.freeze({ kind: identityKind, value: identityValue ?? 'owner' }),
    text,
    capability: capability ?? null,
    workSessionId: workSessionId ?? null,
  });
}

export function createChannelRouter({ telegramCapabilities = [], clock } = {}) {
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) throw new TypeError('channel_router_clock_required');
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    route(raw) {
      const turn = normalizeTurnInput(raw);
      const policy = turn.capability
        ? classifyChannelCapability({ channel: turn.channel, capability: turn.capability }, { telegramCapabilities })
        : Object.freeze({ decision: 'allow', reason: 'no_capability_requested' });
      return Object.freeze({
        turn: Object.freeze({ ...turn, routedAt: new Date(now()).toISOString() }),
        policy,
      });
    },
  });
}
