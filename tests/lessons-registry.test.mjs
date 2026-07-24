import { describe, expect, it } from 'vitest';
import { createLessonsRegistry, mitigationForCode } from '../src/core/lessons-registry.mjs';

const DAY = 86_400_000;

describe('lessons registry — learn from real failures, avoid repeating', () => {
  it('derives a technical lesson from a real failure (signature + family-based mitigation)', () => {
    let t = 1_000;
    const reg = createLessonsRegistry({ now: () => t });
    const lesson = reg.learnFromFailure({ scope: 'provider', code: 'gemini_timeout' });
    expect(lesson).toMatchObject({ signature: 'provider:gemini_timeout', origin: 'technical', confirmed: true, occurrences: 1 });
    expect(lesson.mitigation).toMatch(/délai|patience|réessayer/u);

    // Pré-vol : la leçon technique est active d'office (L1 technique = auto).
    expect(reg.preflight('provider:gemini_timeout')).toMatchObject({ signature: 'provider:gemini_timeout', occurrences: 1 });
    expect(reg.preflight('provider:jamais_vu')).toBeNull();
  });

  it('maps mitigation by code FAMILY, never by an assumed exact code', () => {
    expect(mitigationForCode('sms_send_denied')).toMatch(/refusé|confirmation/u);
    expect(mitigationForCode('host_unreachable')).toMatch(/indisponible|alternative/u);
    expect(mitigationForCode('schema_mismatch')).toMatch(/invalidé|source|supposer/u);
    expect(mitigationForCode('api_rate_limited')).toMatch(/débit|quotas/u);
    expect(mitigationForCode('weird_unknown')).toMatch(/prudemment/u); // défaut, jamais vide
  });

  it('behavioral lessons are INACTIVE until Nasro confirms them (L1 mixte)', () => {
    const reg = createLessonsRegistry();
    reg.proposeBehavioral({ signature: 'value:overwrite_without_check', motif: 'valeur changée sans vérifier', mitigation: 'grep la source avant de modifier' });
    expect(reg.preflight('value:overwrite_without_check')).toBeNull(); // proposée ≠ active
    expect(reg.confirm('value:overwrite_without_check')).toBe(true);
    expect(reg.preflight('value:overwrite_without_check')).toMatchObject({ origin: 'behavioral' });
  });

  it('L3: goes dormant after N successes but a relapse REACTIVATES and resets the streak', () => {
    let t = 1_000;
    const reg = createLessonsRegistry({ now: () => t, dormantAfterSuccesses: 2 });
    reg.learnFromFailure({ scope: 'mission', code: 'nav_failed' });
    reg.recordSuccess('mission:nav_failed');
    expect(reg.preflight('mission:nav_failed')).not.toBeNull(); // 1 succès < 2 → encore active
    reg.recordSuccess('mission:nav_failed');
    expect(reg.preflight('mission:nav_failed')).toBeNull(); // en veille

    // rechute : la leçon se réveille, compteur remis à zéro.
    const revived = reg.learnFromFailure({ scope: 'mission', code: 'nav_failed' });
    expect(revived.occurrences).toBe(2);
    expect(revived.successStreak).toBe(0);
    expect(reg.preflight('mission:nav_failed')).not.toBeNull();
  });

  it('L3: a lesson expires after a long silence (TTL)', () => {
    let t = 1_000;
    const reg = createLessonsRegistry({ now: () => t, ttlMs: 10 * DAY });
    reg.learnFromFailure({ scope: 'provider', code: 'x_timeout' });
    t += 11 * DAY;
    expect(reg.preflight('provider:x_timeout')).toBeNull();
    expect(reg.list()).toHaveLength(0);
  });

  it('a lesson never grants a privilege — preflight only WARNS, forget removes it', () => {
    const reg = createLessonsRegistry();
    reg.learnFromFailure({ scope: 'sms', code: 'quiet_hours' });
    const warn = reg.preflight('sms:quiet_hours');
    expect(warn).toHaveProperty('mitigation');
    expect(warn).not.toHaveProperty('allow'); // aucune notion d'autorisation
    expect(reg.forget('sms:quiet_hours')).toBe(true);
    expect(reg.preflight('sms:quiet_hours')).toBeNull();
  });

  it('serializes to the vault and hydrates back (L4 persistence)', () => {
    const reg = createLessonsRegistry({ now: () => 5_000 });
    reg.learnFromFailure({ scope: 'provider', code: 'deepseek_unavailable' });
    const blob = reg.serialize();

    const restored = createLessonsRegistry({ now: () => 6_000 });
    expect(restored.hydrate(blob)).toBe(true);
    expect(restored.preflight('provider:deepseek_unavailable')).toMatchObject({ signature: 'provider:deepseek_unavailable' });
    expect(restored.hydrate('not json')).toBe(false);
  });

  it('rejects malformed failures', () => {
    const reg = createLessonsRegistry();
    expect(() => reg.learnFromFailure({ scope: '', code: 'x' })).toThrow('lesson_failure_invalid');
    expect(() => reg.proposeBehavioral({ signature: 'nope' })).toThrow('lesson_signature_invalid');
  });
});
