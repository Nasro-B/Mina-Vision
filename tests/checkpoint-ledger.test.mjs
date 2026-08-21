import { describe, expect, it } from 'vitest';
import { createCheckpointLedger } from '../src/code/self/checkpoint-ledger.mjs';

describe('checkpoint-ledger (timeline T5.1)', () => {
  it('record append une entrée complète (id, date, sha, tag, origine, gates, boot)', () => {
    const led = createCheckpointLedger({ now: () => Date.parse('2026-08-21T11:30:00Z') });
    const cp = led.record({ commitSha: 'abc1234', origin: 'self-change', gates: { unit: 'green', smoke: 'ok' }, bootProven: true });
    expect(cp).toMatchObject({ id: 'cp-1', commitSha: 'abc1234', tag: 'mina-self/1', origin: 'self-change', bootProven: true });
    expect(cp.date).toBe('2026-08-21T11:30:00.000Z');
  });

  it('APPEND-ONLY : chaque record s’ajoute, tag↔numéro cohérent', () => {
    const led = createCheckpointLedger();
    led.record({ commitSha: 'aaaaaaa', origin: 'manual', bootProven: true });
    led.record({ commitSha: 'bbbbbbb', origin: 'self-change', bootProven: false });
    const list = led.list();
    expect(list).toHaveLength(2);
    expect(list[1].tag).toBe('mina-self/2');
    expect(led.byTag('mina-self/1').commitSha).toBe('aaaaaaa');
  });

  it('lastHealthy = dernier checkpoint avec boot prouvé', () => {
    const led = createCheckpointLedger();
    led.record({ commitSha: '1111111', origin: 'manual', bootProven: true });
    led.record({ commitSha: '2222222', origin: 'self-change', bootProven: true });
    led.record({ commitSha: '3333333', origin: 'self-change', bootProven: false }); // boot cassé
    expect(led.lastHealthy().commitSha).toBe('2222222'); // pas le 3 (boot non prouvé)
  });

  it('refuse un sha invalide et une origine inconnue', () => {
    const led = createCheckpointLedger();
    expect(() => led.record({ commitSha: 'xyz', origin: 'manual' })).toThrow('sha_invalid');
    expect(() => led.record({ commitSha: 'abcdef1', origin: 'pirate' })).toThrow('origin_invalid');
  });

  it('lastHealthy null si aucun boot prouvé', () => {
    const led = createCheckpointLedger();
    led.record({ commitSha: 'deadbee', origin: 'self-change', bootProven: false });
    expect(led.lastHealthy()).toBeNull();
  });
});
