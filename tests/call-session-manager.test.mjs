import { describe, expect, it } from 'vitest';
import { createCallSession } from '../src/telephony/call-session-manager.mjs';

describe('call-session-manager', () => {
  it('déroule le chemin nominal jusqu’à task_synced', () => {
    const s = createCallSession({ callId: 'c1', deviceId: 'd1' });
    for (const next of ['screening', 'eligible', 'answering', 'disclosure', 'consent', 'taking_message', 'readback', 'confirmed', 'completed', 'task_pending', 'task_synced']) {
      s.transition(next);
    }
    expect(s.state()).toBe('task_synced');
    expect(s.isTerminal()).toBe(true);
    expect(s.history()).toHaveLength(12);
  });

  it('refuse une transition illégale', () => {
    const s = createCallSession({ callId: 'c', deviceId: 'd' });
    expect(() => s.transition('confirmed')).toThrow('call_transition_invalid:detected->confirmed');
  });

  it('panne média depuis un état actif → media_failed (jamais un appel silencieux)', () => {
    const s = createCallSession({ callId: 'c', deviceId: 'd' });
    s.transition('screening'); s.transition('eligible'); s.transition('answering'); s.transition('disclosure');
    expect(s.fail('media_failed')).toBe('media_failed');
    expect(s.isTerminal()).toBe(true);
    expect(() => s.transition('consent')).toThrow('call_transition_invalid');
  });

  it('refus à l’étape consentement → refused', () => {
    const s = createCallSession({ callId: 'c', deviceId: 'd' });
    s.transition('screening'); s.transition('eligible'); s.transition('answering'); s.transition('disclosure'); s.transition('consent');
    expect(s.transition('refused')).toBe('refused');
    expect(s.isTerminal()).toBe(true);
  });

  it('correction : readback → taking_message est autorisé', () => {
    const s = createCallSession({ callId: 'c', deviceId: 'd' });
    for (const n of ['screening', 'eligible', 'answering', 'disclosure', 'consent', 'taking_message', 'readback']) s.transition(n);
    expect(s.can('taking_message')).toBe(true);
    expect(s.transition('taking_message')).toBe('taking_message');
  });

  it('un terminal n’a aucune sortie ; fail sur terminal est idempotent', () => {
    const s = createCallSession({ callId: 'c', deviceId: 'd' });
    s.transition('missed');
    expect(s.isTerminal()).toBe(true);
    expect(s.fail('media_failed')).toBe('missed'); // déjà terminé, pas d'écrasement
  });

  it('exige callId et deviceId', () => {
    expect(() => createCallSession({ callId: 'c' })).toThrow('call_session_ids_required');
  });
});
