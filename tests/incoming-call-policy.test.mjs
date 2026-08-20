import { describe, expect, it } from 'vitest';
import {
  READINESS_CONDITIONS, evaluateIncomingCall, evaluateReadiness,
} from '../src/telephony/incoming-call-policy.mjs';

const allReady = Object.fromEntries(READINESS_CONDITIONS.map((c) => [c, true]));

describe('incoming-call-policy : readiness (§7)', () => {
  it('prêt seulement si TOUTES les conditions sont vraies', () => {
    expect(evaluateReadiness(allReady).ready).toBe(true);
    const partial = evaluateReadiness({ ...allReady, hfp_endpoint: false, tts: false });
    expect(partial.ready).toBe(false);
    expect(partial.missing).toEqual(expect.arrayContaining(['hfp_endpoint', 'tts']));
  });
});

describe('incoming-call-policy : éligibilité (§9, §11, §19)', () => {
  const ready = evaluateReadiness(allReady);

  it('niveau observation → ne décroche JAMAIS', () => {
    expect(evaluateIncomingCall({ readiness: ready, numberE164: '+33612345678', level: 'observe' }))
      .toMatchObject({ eligible: false, reason: 'observation_only' });
  });

  it('pas prêt → non éligible avec la condition manquante', () => {
    const notReady = evaluateReadiness({ ...allReady, rx_capture: false });
    expect(evaluateIncomingCall({ readiness: notReady, numberE164: '+33612345678', level: 'assisted' }))
      .toMatchObject({ eligible: false, reason: 'not_ready:rx_capture' });
  });

  it('un appel Mina déjà actif → refusé (§11)', () => {
    expect(evaluateIncomingCall({ readiness: ready, numberE164: '+33612345678', level: 'assisted', activeMinaCalls: 1 }))
      .toMatchObject({ eligible: false, reason: 'concurrent_call' });
  });

  it('numéro d’urgence / court / masqué → toujours refusé', () => {
    expect(evaluateIncomingCall({ readiness: ready, numberE164: '112', level: 'assisted' }).reason).toBe('emergency_or_short');
    expect(evaluateIncomingCall({ readiness: ready, numberE164: '36000', level: 'assisted' }).reason).toBe('emergency_or_short');
    expect(evaluateIncomingCall({ readiness: ready, numberE164: null, level: 'assisted' }).reason).toBe('emergency_or_short');
  });

  it('pilote : numéro inconnu / hors horaires refusés, contact connu en horaires accepté', () => {
    const known = ['+33612345678'];
    const businessHours = { startHour: 9, endHour: 18 };
    const at14h = new Date(2026, 6, 29, 14, 0, 0).getTime();
    const at22h = new Date(2026, 6, 29, 22, 0, 0).getTime();
    expect(evaluateIncomingCall({ readiness: ready, numberE164: '+33699999999', level: 'pilot', knownContacts: known, atMs: at14h }).reason).toBe('unknown_number');
    expect(evaluateIncomingCall({ readiness: ready, numberE164: '+33612345678', level: 'pilot', knownContacts: known, businessHours, atMs: at22h }).reason).toBe('outside_hours');
    expect(evaluateIncomingCall({ readiness: ready, numberE164: '+33612345678', level: 'pilot', knownContacts: known, businessHours, atMs: at14h }).eligible).toBe(true);
  });

  it('assisté + prêt + numéro normal → éligible', () => {
    expect(evaluateIncomingCall({ readiness: ready, numberE164: '+33612345678', level: 'assisted' }))
      .toMatchObject({ eligible: true, reason: null });
  });
});
