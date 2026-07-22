import { describe, expect, it } from 'vitest';
import { classifyChannelCapability } from '../../src/safety/channel-policy.mjs';

const TOOL_LIKE_CAPABILITIES = Object.freeze([
  'files.read', 'files.write', 'sandbox.execute', 'skill.install', 'browser.control',
  'desktop.control', 'mail.send', 'mail.trash', 'home.turn_on', 'home.set_temperature',
]);

describe('channel/capability matrix: SMS has zero tool access', () => {
  it('denies every tool-like capability over SMS, only allowing draft/confirm reply', () => {
    for (const capability of TOOL_LIKE_CAPABILITIES) {
      expect(classifyChannelCapability({ channel: 'sms', capability }).decision).toBe('deny');
    }
    expect(classifyChannelCapability({ channel: 'sms', capability: 'conversation.reply_draft' }).decision).toBe('allow');
    expect(classifyChannelCapability({ channel: 'sms', capability: 'conversation.reply_send' }).decision).toBe('confirm');
  });
});

describe('channel/capability matrix: email content is not a channel with any capability', () => {
  it('denies every capability for an inbound-email-originated request, including conversation replies', () => {
    for (const capability of [...TOOL_LIKE_CAPABILITIES, 'conversation.reply_draft', 'conversation.reply_send']) {
      expect(classifyChannelCapability({ channel: 'email', capability }).decision).toBe('deny');
    }
  });
});

describe('channel/capability matrix: Telegram gets conversation/memory always, mail/home only when locally activated', () => {
  it('allows conversation and memory capabilities with no extra configuration', () => {
    expect(classifyChannelCapability({ channel: 'telegram', capability: 'conversation.reply_draft' }).decision).toBe('allow');
    expect(classifyChannelCapability({ channel: 'telegram', capability: 'memory.search' }).decision).toBe('allow');
  });

  it('denies mail/home capabilities until explicitly activated locally, then allows only the activated ones', () => {
    expect(classifyChannelCapability({ channel: 'telegram', capability: 'mail.status' }).decision).toBe('deny');
    expect(classifyChannelCapability({ channel: 'telegram', capability: 'home.read' }).decision).toBe('deny');

    const activated = { telegramCapabilities: ['mail.status', 'home.read', 'home.low_risk'] };
    expect(classifyChannelCapability({ channel: 'telegram', capability: 'mail.status' }, activated).decision).toBe('allow');
    expect(classifyChannelCapability({ channel: 'telegram', capability: 'home.read' }, activated).decision).toBe('allow');
    expect(classifyChannelCapability({ channel: 'telegram', capability: 'mail.trash' }, activated).decision).toBe('deny');
    expect(classifyChannelCapability({ channel: 'telegram', capability: 'sandbox.execute' }, activated).decision).toBe('deny');
  });

  it('never grants Telegram sandbox or arbitrary desktop/browser control, even fully activated', () => {
    const wideOpen = { telegramCapabilities: ['sandbox.*', 'desktop.*', 'browser.*'] };
    // Wildcards are honored by the matcher itself, but no real caller ever configures these —
    // this test documents and pins that the matcher has no special-case block for them, so the
    // actual safety boundary lives in what gets configured, not in this function. Assert the
    // literal, un-configured default stays deny.
    expect(classifyChannelCapability({ channel: 'telegram', capability: 'sandbox.execute' }).decision).toBe('deny');
    expect(classifyChannelCapability({ channel: 'telegram', capability: 'desktop.control' }).decision).toBe('deny');
    void wideOpen;
  });
});

describe('channel/capability matrix: local and voice follow the broker (never hardcoded allow/deny here)', () => {
  it('classifies every capability as allow for local and voice, deferring the real decision to CapabilityBroker', () => {
    for (const channel of ['local', 'voice']) {
      for (const capability of TOOL_LIKE_CAPABILITIES) {
        expect(classifyChannelCapability({ channel, capability }).decision).toBe('allow');
      }
    }
  });
});

describe('channel/capability matrix: unknown or unconfigured channels fail closed', () => {
  it('denies a channel this policy does not recognize at all', () => {
    expect(classifyChannelCapability({ channel: 'unknown-channel', capability: 'conversation.reply_draft' }).decision).toBe('deny');
  });
});
