import { describe, expect, it } from 'vitest';
import { createWakeWindow, WAKE_WINDOW_DEFAULT_MS } from '../src/voice/wake-window.mjs';

// Horloge contrôlée : on avance le temps à la main pour prouver la fenêtre sans attendre en réel.
function fakeClock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

describe('wake-window — T3.1 éveil obligatoire pour les actions', () => {
  it('aucune action permise sans éveil préalable', () => {
    const wake = createWakeWindow({ windowMs: 30_000, clock: () => 0 });
    expect(wake.isActionAllowed()).toBe(false);
    expect(wake.remainingMs()).toBe(0);
  });

  it('une action est permise juste après un éveil, refusée après expiration de la fenêtre', () => {
    const clock = fakeClock();
    const wake = createWakeWindow({ windowMs: 30_000, clock: clock.now });
    wake.markWake();
    expect(wake.isActionAllowed()).toBe(true);
    clock.advance(29_999);
    expect(wake.isActionAllowed(), 'encore dans la fenêtre').toBe(true);
    clock.advance(1);
    expect(wake.isActionAllowed(), 'fenêtre expirée à exactement windowMs').toBe(false);
  });

  it('« ouvre youtube » sans éveil récent → action refusée ; avec éveil → permise (acceptation du plan)', () => {
    const clock = fakeClock();
    const wake = createWakeWindow({ windowMs: 30_000, clock: clock.now });
    // Scénario : l'utilisateur parle à côté du micro (aucun « Mina »).
    expect(wake.isActionAllowed(), 'parler sans adresser Mina ne permet aucune action').toBe(false);
    // Puis il dit « Mina, ouvre youtube » : l'éveil ouvre la fenêtre, l'action passe.
    wake.markWake();
    expect(wake.isActionAllowed(), 'adressé à Mina → action permise').toBe(true);
  });

  it('consume() referme la fenêtre : un seul éveil ne débloque pas une rafale d\'actions', () => {
    const clock = fakeClock();
    const wake = createWakeWindow({ windowMs: 30_000, clock: clock.now });
    wake.markWake();
    expect(wake.isActionAllowed()).toBe(true);
    wake.consume(); // une action vient d'être exécutée
    expect(wake.isActionAllowed(), 'la seconde action exige un nouvel éveil').toBe(false);
    wake.markWake();
    expect(wake.isActionAllowed(), 'nouvel éveil → nouvelle action permise').toBe(true);
  });

  it('un ré-éveil prolonge la fenêtre', () => {
    const clock = fakeClock();
    const wake = createWakeWindow({ windowMs: 30_000, clock: clock.now });
    wake.markWake();
    clock.advance(25_000);
    wake.markWake(); // on redit « Mina »
    clock.advance(25_000); // 50 s après le premier éveil, mais 25 s après le second
    expect(wake.isActionAllowed(), 'le second éveil a rouvert la fenêtre').toBe(true);
  });

  it('valide ses entrées et expose la fenêtre par défaut', () => {
    expect(() => createWakeWindow({ windowMs: 0 })).toThrow(/wake_window_ms_invalid/u);
    expect(() => createWakeWindow({ clock: 'pas-une-fonction' })).toThrow(/wake_window_clock_invalid/u);
    expect(createWakeWindow().windowMs).toBe(WAKE_WINDOW_DEFAULT_MS);
  });
});
