import { describe, expect, it } from 'vitest';
import { callDigest, createCallPolicy, normalizeCallNumber } from '../src/telephony/call-policy.mjs';

describe('call number normalization (never guesses the country code)', () => {
  it('accepts +E.164 and strips spacing/punctuation', () => {
    expect(normalizeCallNumber('+33 6 12 34 56 78')).toEqual({ number: '+33612345678', kind: 'e164' });
    expect(normalizeCallNumber('+1 (555) 010-2020')).toEqual({ number: '+15550102020', kind: 'e164' });
  });
  it('classifies short/premium numbers separately (composeur only)', () => {
    expect(normalizeCallNumber('3200')).toEqual({ number: '3200', kind: 'short_premium' });
  });
  it('rejects a bare national number — no country assumed', () => {
    expect(normalizeCallNumber('0612345678')).toBeNull(); // pas de +indicatif → refus, jamais deviné
    expect(normalizeCallNumber('abc')).toBeNull();
    expect(normalizeCallNumber('')).toBeNull();
  });
});

describe('call digest binds a confirmation to the exact (action, number)', () => {
  it('differs when the number differs', () => {
    expect(callDigest({ action: 'call', number: '+33612345678' }))
      .not.toBe(callDigest({ action: 'call', number: '+33612345679' }));
    expect(callDigest({ action: 'call', number: '+33612345678' })).toMatch(/^[a-f0-9]{64}$/u);
  });
});

describe('call policy — safe by default (D1 composeur, D4 confirmation systématique)', () => {
  it('DEFAULT mode is dial_only: never a programmatic call, only the dialer', () => {
    const policy = createCallPolicy();
    expect(policy.mode).toBe('dial_only');
    expect(policy.decide({ number: '+33612345678' })).toMatchObject({ decision: 'dial' });
    // même un numéro en « liste blanche » ne part pas tout seul en dial_only
    const allow = createCallPolicy({ mode: 'dial_only', allowlist: ['+33612345678'] });
    expect(allow.decide({ number: '+33612345678' }).decision).toBe('dial');
  });

  it('confirm_every_call asks every time; invalid numbers are rejected', () => {
    const policy = createCallPolicy({ mode: 'confirm_every_call' });
    expect(policy.decide({ number: '+33612345678' }).decision).toBe('confirm');
    expect(policy.decide({ number: '0612345678' }).decision).toBe('reject');
  });

  it('STRUCTURAL: auto is reachable ONLY with every lock open', () => {
    const base = {
      mode: 'auto_allowlisted',
      allowlist: ['+33612345678'],
      quietHoursStart: 8, quietHoursEnd: 22,
      now: () => Date.parse('2026-07-24T10:00:00'),
    };
    const ok = createCallPolicy(base);
    expect(ok.decide({ number: '+33612345678' })).toEqual({ decision: 'auto', reason: null, number: '+33612345678' });

    // remove ONE lock at a time → never auto
    expect(createCallPolicy(base).decide({ number: '+33612345678', ownerRecognized: false }).decision).toBe('confirm');
    expect(createCallPolicy(base).decide({ number: '+33612345678', isNewRecipient: true }).decision).toBe('confirm');
    expect(createCallPolicy(base).decide({ number: '+33699999999' }).decision).toBe('confirm'); // hors liste
    expect(createCallPolicy({ ...base, allowlist: ['3200'] }).decide({ number: '3200' }).decision).toBe('confirm'); // premium jamais auto
    expect(createCallPolicy({ ...base, now: () => Date.parse('2026-07-24T03:00:00') }).decide({ number: '+33612345678' }).decision).toBe('confirm'); // heures calmes
  });

  it('per-minute / per-hour / per-day budgets force confirm once exceeded', () => {
    const at = Date.parse('2026-07-24T10:00:00');
    const policy = createCallPolicy({
      mode: 'auto_allowlisted', allowlist: ['+33612345678'],
      maxPerMinute: 1, now: () => at,
    });
    expect(policy.decide({ number: '+33612345678' }).decision).toBe('auto');
    policy.recordPlaced(at);
    expect(policy.decide({ number: '+33612345678' }).decision).toBe('confirm'); // 2e dans la minute
  });

  it('a global stop reverts automation to human confirmation until reactivated', () => {
    const policy = createCallPolicy({ mode: 'auto_allowlisted', allowlist: ['+33612345678'], quietHoursStart: 0, quietHoursEnd: 24, now: () => Date.parse('2026-07-24T10:00:00') });
    expect(policy.decide({ number: '+33612345678' }).decision).toBe('auto');
    policy.revokeAutomation();
    expect(policy.mode).toBe('confirm_every_call');
    expect(policy.decide({ number: '+33612345678' }).decision).toBe('confirm');
    policy.reactivate();
    expect(policy.decide({ number: '+33612345678' }).decision).toBe('auto');
  });
});
