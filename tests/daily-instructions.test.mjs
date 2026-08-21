import { describe, expect, it } from 'vitest';
import { createDailyInstructions } from '../src/personal/daily-instructions.mjs';

function memStore() {
  let record = null;
  return { read: () => record, write: (value) => { record = value; }, _peek: () => record };
}

// Instants fixes (fuseau Europe/Paris) : 2026-08-21 10:00 et 14:00 même jour, 2026-08-22 09:00 lendemain.
const DAY1_10H = Date.UTC(2026, 7, 21, 8, 0); // 10:00 Paris (UTC+2 en août)
const DAY1_14H = Date.UTC(2026, 7, 21, 12, 0);
const DAY2_09H = Date.UTC(2026, 7, 22, 7, 0);

describe('daily-instructions (C4 — consignes du jour)', () => {
  it('exige un store', () => {
    expect(() => createDailyInstructions({ store: null })).toThrow('daily_instructions_store_required');
  });

  it('set puis current le même jour → renvoie le texte', () => {
    const di = createDailyInstructions({ store: memStore(), clock: () => DAY1_10H });
    di.set('rappeler les clients après 16h');
    expect(di.current({ at: DAY1_14H })).toBe('rappeler les clients après 16h');
  });

  it('une consigne d’hier EXPIRE le lendemain (jamais appliquée par erreur)', () => {
    const store = memStore();
    const di = createDailyInstructions({ store });
    di.set('consigne d’hier', { at: DAY1_10H });
    expect(di.current({ at: DAY2_09H })).toBe('');
    // l'enregistrement existe encore mais n'est plus servi (jour différent)
    expect(store._peek()?.text).toBe('consigne d’hier');
  });

  it('texte vide efface (aucune consigne fantôme)', () => {
    const store = memStore();
    const di = createDailyInstructions({ store, clock: () => DAY1_10H });
    di.set('quelque chose');
    di.set('   ');
    expect(store._peek()).toBeNull();
    expect(di.current({ at: DAY1_14H })).toBe('');
  });

  it('tronque à maxLength', () => {
    const store = memStore();
    const di = createDailyInstructions({ store, clock: () => DAY1_10H, maxLength: 8 });
    di.set('abcdefghijklmnop');
    expect(store._peek().text).toBe('abcdefgh');
  });

  it('clear() vide les consignes', () => {
    const store = memStore();
    const di = createDailyInstructions({ store, clock: () => DAY1_10H });
    di.set('x');
    di.clear();
    expect(di.current({ at: DAY1_14H })).toBe('');
  });
});
