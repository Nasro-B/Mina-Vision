const TELEGRAM_PREFIXES = Object.freeze(['conversation.', 'memory.']);

export function classifyChannelCapability({ channel, capability }, { telegramCapabilities = [] } = {}) {
  if (channel === 'local' || channel === 'voice') {
    return { decision: 'allow', reason: 'channel_policy' };
  }

  if (channel === 'sms') {
    if (capability === 'conversation.reply_draft') {
      return { decision: 'allow', reason: 'channel_policy' };
    }
    if (capability === 'conversation.reply_send') {
      return { decision: 'confirm', reason: 'channel_policy' };
    }
    return { decision: 'deny', reason: 'channel_policy' };
  }

  if (channel === 'telegram') {
    const allowed = TELEGRAM_PREFIXES.some((prefix) => capability.startsWith(prefix))
      || telegramCapabilities.some((configured) => configured === capability
        || (configured.endsWith('*') && capability.startsWith(configured.slice(0, -1))));
    return { decision: allowed ? 'allow' : 'deny', reason: 'channel_policy' };
  }

  return { decision: 'deny', reason: 'channel_policy' };
}
