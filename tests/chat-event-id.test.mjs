import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMonotonicUlid, decodeUlidTime } from '../src/contracts/event-id.mjs';

describe('ULID monotone du chat', () => {
  it('produit 26 caractères Crockford Base32', () => {
    const next = createMonotonicUlid({ now: () => 1_784_732_400_000 });
    expect(next()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
  });

  it('garde l\'ordre lexical sur 1 000 générations dans la MÊME milliseconde', () => {
    const next = createMonotonicUlid({ now: () => 1_784_732_400_000 });
    const ids = Array.from({ length: 1_000 }, () => next());
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(1_000);
  });

  it('ne recule JAMAIS quand l\'horloge système recule', () => {
    let clock = 1_784_732_400_000;
    const next = createMonotonicUlid({ now: () => clock });
    const before = next();
    clock -= 60_000; // NTP ou changement d'heure
    const after = next();
    expect(after > before).toBe(true);
    // Le temps encodé reste celui du dernier maximum connu.
    expect(decodeUlidTime(after)).toBe(decodeUlidTime(before));
  });

  it('n\'entre pas en collision sur 100 000 identifiants avec un aléa réel', () => {
    const next = createMonotonicUlid({ randomBytes });
    const ids = new Set();
    for (let index = 0; index < 100_000; index += 1) ids.add(next());
    expect(ids.size).toBe(100_000);
  });

  it('signale la saturation d\'entropie au lieu de boucler ou de reculer', () => {
    // Aléa forcé à 0xff… : le tout premier incrément sature les 80 bits.
    const next = createMonotonicUlid({
      now: () => 1_784_732_400_000,
      randomBytes: (size) => Buffer.alloc(size, 0xff),
    });
    expect(next()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(() => next()).toThrow('ulid_entropy_exhausted');
  });

  it('encode le temps de façon relisible', () => {
    const now = 1_784_732_400_000;
    const next = createMonotonicUlid({ now: () => now });
    expect(decodeUlidTime(next())).toBe(now);
  });

  it('refuse une horloge invalide plutôt que de produire un identifiant douteux', () => {
    expect(() => createMonotonicUlid({ now: () => Number.NaN })()).toThrow('ulid_horloge_invalide');
    expect(() => createMonotonicUlid({ now: () => -1 })()).toThrow('ulid_horloge_invalide');
  });
});
