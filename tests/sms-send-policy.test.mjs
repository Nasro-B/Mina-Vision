import { describe, expect, it } from 'vitest';
import { createSmsSendPolicy } from '../src/messaging/sms-send-policy.mjs';

const OWNER_KNOWN = { recipient: '+33600000002', content: 'Bonjour, à demain.', ownerRecognized: true };

describe('createSmsSendPolicy', () => {
  it('rejects an unknown mode', () => {
    expect(() => createSmsSendPolicy({ mode: 'bogus' })).toThrow(TypeError);
  });

  it('draft_only never sends automatically, even for an allowlisted recipient', () => {
    const policy = createSmsSendPolicy({ mode: 'draft_only', allowlist: ['+33600000002'] });
    expect(policy.decide(OWNER_KNOWN).decision).toBe('draft_only');
  });

  it('confirm_every_send always confirms, even for an allowlisted recipient', () => {
    const policy = createSmsSendPolicy({ mode: 'confirm_every_send', allowlist: ['+33600000002'] });
    expect(policy.decide(OWNER_KNOWN).decision).toBe('confirm');
  });

  describe('auto_allowlisted', () => {
    it('auto-sends only to an allowlisted recipient with plain content and a recognized owner', () => {
      const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33600000002'] });
      expect(policy.decide(OWNER_KNOWN).decision).toBe('auto');
    });

    it('requires confirmation for a recipient not on the allowlist — never invents authorization', () => {
      const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33600000009'] });
      expect(policy.decide(OWNER_KNOWN).decision).toBe('confirm');
    });

    it('requires confirmation when the owner is not recognized', () => {
      const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33600000002'] });
      expect(policy.decide({ ...OWNER_KNOWN, ownerRecognized: false }).decision).toBe('confirm');
    });

    it('requires confirmation for a new (never-seen) recipient even if somehow allowlisted', () => {
      const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33600000002'] });
      expect(policy.decide({ ...OWNER_KNOWN, isNewRecipient: true }).decision).toBe('confirm');
    });

    it('requires confirmation for a group conversation', () => {
      const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33600000002'] });
      expect(policy.decide({ ...OWNER_KNOWN, isGroup: true }).decision).toBe('confirm');
    });

    it('requires confirmation for a short/premium number', () => {
      const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['81818'] });
      expect(policy.decide({ ...OWNER_KNOWN, recipient: '81818' }).decision).toBe('confirm');
    });

    it('requires confirmation when an attachment or a secondary action is present', () => {
      const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33600000002'] });
      expect(policy.decide({ ...OWNER_KNOWN, hasAttachment: true }).decision).toBe('confirm');
      expect(policy.decide({ ...OWNER_KNOWN, hasSecondaryAction: true }).decision).toBe('confirm');
    });

    it.each(['Voici mon mot de passe: 1234', 'Mon code de vérification est 445566', 'Numéro de carte 4111111111111111'])(
      'requires confirmation for sensitive content "%s"', (content) => {
        const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33600000002'] });
        expect(policy.decide({ ...OWNER_KNOWN, content }).decision).toBe('confirm');
      },
    );

    it('requires confirmation outside the configured quiet-hours window', () => {
      const policy = createSmsSendPolicy({
        mode: 'auto_allowlisted', allowlist: ['+33600000002'],
        quietHoursStart: 8, quietHoursEnd: 22, now: () => new Date(2026, 0, 1, 23, 0),
      });
      expect(policy.decide(OWNER_KNOWN).decision).toBe('confirm');
    });

    it('auto-sends inside the configured window', () => {
      const policy = createSmsSendPolicy({
        mode: 'auto_allowlisted', allowlist: ['+33600000002'],
        quietHoursStart: 8, quietHoursEnd: 22, now: () => new Date(2026, 0, 1, 14, 0),
      });
      expect(policy.decide(OWNER_KNOWN).decision).toBe('auto');
    });

    it('requires confirmation once the per-minute budget is exhausted', () => {
      let clock = 1_000_000;
      const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33600000002'], maxPerMinute: 2, now: () => clock });
      policy.recordSent(clock); policy.recordSent(clock += 1_000);
      expect(policy.decide(OWNER_KNOWN).decision).toBe('confirm');
    });

    it('requires confirmation once the per-day budget is exhausted, independent of the per-minute one', () => {
      let clock = 1_000_000;
      const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33600000002'], maxPerMinute: 100, maxPerDay: 2, now: () => clock });
      policy.recordSent(clock); clock += 120_000; policy.recordSent(clock);
      expect(policy.decide(OWNER_KNOWN).decision).toBe('confirm');
    });

    it('the budget window rolls off — an old send no longer counts', () => {
      let clock = 1_000_000;
      const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33600000002'], maxPerMinute: 1, now: () => clock });
      policy.recordSent(clock);
      clock += 61_000; // past the 1-minute window
      expect(policy.decide(OWNER_KNOWN).decision).toBe('auto');
    });
  });

  describe('global kill switch', () => {
    it('revokeAutomation() forces confirm_every_send immediately, even mid-allowlisted-window', () => {
      const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33600000002'] });
      expect(policy.decide(OWNER_KNOWN).decision).toBe('auto');

      policy.revokeAutomation();

      expect(policy.decide(OWNER_KNOWN).decision).toBe('confirm');
      expect(policy.mode).toBe('confirm_every_send');
    });

    it('reactivate() restores the originally configured mode after a revoke', () => {
      const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33600000002'] });
      policy.revokeAutomation();
      policy.reactivate();
      expect(policy.decide(OWNER_KNOWN).decision).toBe('auto');
    });
  });

  it('acceptance: no automatic send is ever produced for a recipient outside the allowlist, across every field combination', () => {
    const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33600000002'] });
    const outsiders = ['+33699999999', '81818', 'unknown', ''];
    for (const recipient of outsiders) {
      expect(policy.decide({ recipient, content: 'x', ownerRecognized: true }).decision).not.toBe('auto');
    }
  });
});
