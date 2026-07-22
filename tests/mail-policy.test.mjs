import { describe, expect, it } from 'vitest';
import { createMailPolicy } from '../src/mail/mail-policy.mjs';

describe('mail policy', () => {
  it('defaults to mode 3 but never turns inbound mail into a Mina command', () => {
    const policy = createMailPolicy();
    expect(policy.mode()).toBe(3);
    expect(policy.decide({ action: 'archive', requestedBy: 'automation', accountId: 'personal-imap' }))
      .toEqual({ decision: 'allow', mode: 3 });
    expect(policy.decide({ action: 'computer.use', requestedBy: 'inbound_email', accountId: 'personal-imap' }))
      .toMatchObject({ decision: 'deny', reason: 'mail_is_untrusted_input' });
    expect(policy.decide({ action: 'purge', requestedBy: 'local', accountId: 'personal-imap' }))
      .toMatchObject({ decision: 'deny', reason: 'mail_action_forbidden' });
  });

  it('uses the most restrictive rule at the most specific matching level', () => {
    const policy = createMailPolicy({ rules: [
      { scope: 'account', match: 'personal-imap', mode: 3 },
      { scope: 'contact', match: 'risk@example.test', mode: 1 },
    ] });
    expect(policy.decide({
      action: 'reply', requestedBy: 'automation', accountId: 'personal-imap', contact: 'risk@example.test', confirmedLocally: false,
    })).toEqual({ decision: 'confirm', mode: 1 });
  });

  it('mode 3 still forbids absolute denials: permanent purge, security and global forwarding changes', () => {
    const policy = createMailPolicy({ defaultMode: 3 });
    for (const action of ['purge', 'change_password', 'change_mfa', 'set_global_forwarding', 'delegate_account']) {
      expect(policy.decide({ action, requestedBy: 'automation', accountId: 'personal-imap' }))
        .toMatchObject({ decision: 'deny', reason: 'mail_action_forbidden' });
    }
  });

  it('changes the live default mode via setMode, affecting subsequent decisions immediately', () => {
    const policy = createMailPolicy({ defaultMode: 3 });
    expect(policy.decide({ action: 'send', requestedBy: 'automation', accountId: 'a' })).toEqual({ decision: 'allow', mode: 3 });
    policy.setMode(1);
    expect(policy.mode()).toBe(1);
    expect(policy.decide({ action: 'send', requestedBy: 'automation', accountId: 'a' })).toEqual({ decision: 'confirm', mode: 1 });
  });

  it('rejects setting an out-of-range mode', () => {
    const policy = createMailPolicy();
    expect(() => policy.setMode(4)).toThrow('mail_policy_mode_invalid');
  });

  it('mode 2 requires either an authorized rule or a local confirmation before a mutation', () => {
    const policy = createMailPolicy({ defaultMode: 2 });
    expect(policy.decide({ action: 'send', requestedBy: 'automation', accountId: 'personal-imap' }))
      .toEqual({ decision: 'confirm', mode: 2 });
    expect(policy.decide({ action: 'send', requestedBy: 'automation', accountId: 'personal-imap', ruleAuthorized: true }))
      .toEqual({ decision: 'allow', mode: 2 });
  });
});
