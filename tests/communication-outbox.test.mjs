import { describe, expect, it } from 'vitest';
import { createCommunicationOutbox } from '../src/communications/communication-outbox.mjs';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('communication-outbox', () => {
  it('empile et rejoue les opérations dues', () => {
    const c = clock();
    const outbox = createCommunicationOutbox({ now: c.now });
    outbox.enqueue({ opId: 'op1', operation: 'create_task', payload: { title: 'x' } });
    expect(outbox.due()).toHaveLength(1);
    expect(outbox.markSuccess('op1')).toBe(true);
    expect(outbox.size()).toBe(0);
  });

  it('déduplique par clé : une création incertaine n’est pas refaite deux fois', () => {
    const outbox = createCommunicationOutbox();
    outbox.enqueue({ opId: 'op1', operation: 'create_task', dedupeKey: 'evt_123' });
    const second = outbox.enqueue({ opId: 'op2', operation: 'create_task', dedupeKey: 'evt_123' });
    expect(second).toBe('op1'); // renvoie l'opération existante
    expect(outbox.size()).toBe(1);
  });

  it('backoff borné à chaque échec, puis rejeu quand l’heure est atteinte', () => {
    const c = clock();
    const outbox = createCommunicationOutbox({ now: c.now, baseDelayMs: 1_000 });
    outbox.enqueue({ opId: 'op1', operation: 'create_task' });
    const first = outbox.markFailure('op1', 'network');
    expect(first.attempts).toBe(1);
    expect(outbox.due()).toHaveLength(0); // reporté (nextAttemptAt dans le futur)
    c.advance(1_000);
    expect(outbox.due()).toHaveLength(1); // dû à nouveau
  });

  it('dead-letter après le budget de tentatives (jamais de boucle infinie)', () => {
    const outbox = createCommunicationOutbox({ maxAttempts: 3, baseDelayMs: 0 });
    outbox.enqueue({ opId: 'op1', operation: 'create_task' });
    outbox.markFailure('op1');
    outbox.markFailure('op1');
    const last = outbox.markFailure('op1');
    expect(last.deadLettered).toBe(true);
    expect(outbox.size()).toBe(0);
  });

  it('refuse une opération invalide', () => {
    const outbox = createCommunicationOutbox();
    expect(() => outbox.enqueue({ opId: 'x' })).toThrow('communication_outbox_operation_invalid');
  });
});
