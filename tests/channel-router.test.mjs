import { describe, expect, it } from 'vitest';
import { createChannelRouter, normalizeTurnInput } from '../src/messaging/channel-router.mjs';

describe('normalizeTurnInput: builds a channel-tagged TurnInput', () => {
  it('rejects an unknown channel', () => {
    expect(() => normalizeTurnInput({ channel: 'fax', text: 'hi' })).toThrow('channel_router_channel_invalid');
  });

  it('rejects empty text', () => {
    expect(() => normalizeTurnInput({ channel: 'local', text: '' })).toThrow('channel_router_text_invalid');
  });

  it('requires an identity value for sms and telegram', () => {
    expect(() => normalizeTurnInput({ channel: 'sms', text: 'hi' })).toThrow('channel_router_identity_required');
    expect(() => normalizeTurnInput({ channel: 'telegram', text: 'hi' })).toThrow('channel_router_identity_required');
  });

  it('maps sms to a phone identity kind and telegram to a telegram identity kind', () => {
    const sms = normalizeTurnInput({ channel: 'sms', text: 'hi', identityValue: '+33600000000' });
    expect(sms.identity).toEqual({ kind: 'phone', value: '+33600000000' });
    const telegram = normalizeTurnInput({ channel: 'telegram', text: 'hi', identityValue: '111222333' });
    expect(telegram.identity).toEqual({ kind: 'telegram', value: '111222333' });
  });

  it('defaults local and voice to the local_owner identity without requiring identityValue', () => {
    const local = normalizeTurnInput({ channel: 'local', text: 'hi' });
    expect(local.identity).toEqual({ kind: 'local_owner', value: 'owner' });
  });
});

describe('createChannelRouter.route: applies classifyChannelCapability per channel', () => {
  it('allows sms conversation.reply_draft, requires confirm for reply_send', () => {
    const router = createChannelRouter({ clock: () => 0 });
    const draft = router.route({ channel: 'sms', text: 'hi', identityValue: '+33600000000', capability: 'conversation.reply_draft' });
    expect(draft.policy.decision).toBe('allow');
    const send = router.route({ channel: 'sms', text: 'hi', identityValue: '+33600000000', capability: 'conversation.reply_send' });
    expect(send.policy.decision).toBe('confirm');
  });

  it('denies sms requesting an unrelated capability (never PC/files/skills/sandbox/email/home)', () => {
    const router = createChannelRouter({ clock: () => 0 });
    for (const capability of ['files.read', 'skills.run', 'sandbox.execute', 'mail.send', 'home.execute']) {
      const result = router.route({ channel: 'sms', text: 'hi', identityValue: '+33600000000', capability });
      expect(result.policy.decision).toBe('deny');
    }
  });

  it('allows telegram conversation/memory by default, denies unconfigured home/mail capabilities', () => {
    const router = createChannelRouter({ clock: () => 0 });
    const convo = router.route({ channel: 'telegram', text: 'hi', identityValue: '111', capability: 'conversation.reply_send' });
    expect(convo.policy.decision).toBe('allow');
    const home = router.route({ channel: 'telegram', text: 'hi', identityValue: '111', capability: 'home.execute' });
    expect(home.policy.decision).toBe('deny');
  });

  it('allows telegram scoped home/mail capabilities once locally configured', () => {
    const router = createChannelRouter({ telegramCapabilities: ['home.read', 'mail.*'], clock: () => 0 });
    const homeRead = router.route({ channel: 'telegram', text: 'hi', identityValue: '111', capability: 'home.read' });
    expect(homeRead.policy.decision).toBe('allow');
    const mailSearch = router.route({ channel: 'telegram', text: 'hi', identityValue: '111', capability: 'mail.search' });
    expect(mailSearch.policy.decision).toBe('allow');
    const homeExecute = router.route({ channel: 'telegram', text: 'hi', identityValue: '111', capability: 'home.execute' });
    expect(homeExecute.policy.decision).toBe('deny');
  });

  it('local and voice always allow (broker decides upstream)', () => {
    const router = createChannelRouter({ clock: () => 0 });
    const local = router.route({ channel: 'local', text: 'hi', capability: 'anything.at.all' });
    expect(local.policy.decision).toBe('allow');
  });

  it('treats a turn with no requested capability as allow (pure conversation, nothing to authorize)', () => {
    const router = createChannelRouter({ clock: () => 0 });
    const result = router.route({ channel: 'sms', text: 'hi', identityValue: '+33600000000' });
    expect(result.policy).toEqual({ decision: 'allow', reason: 'no_capability_requested' });
  });

  it('stamps routedAt from the injected clock', () => {
    const router = createChannelRouter({ clock: () => 1_700_000_000_000 });
    const result = router.route({ channel: 'local', text: 'hi' });
    expect(result.turn.routedAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('requires a clock', () => {
    expect(() => createChannelRouter({})).toThrow('channel_router_clock_required');
  });
});
