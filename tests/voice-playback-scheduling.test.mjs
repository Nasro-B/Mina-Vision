// Micro-coupures dans les réponses vocales (« perturbations », 2026-07-22) — cause : marge de
// démarrage de 20 ms dans le scheduling Web Audio ; tout chunk en retard réseau/IPC créait un
// trou audible, répété à chaque hoquet. Contrats du correctif :
//   1. Début de salve (file vide) → coussin de 150 ms qui absorbe la gigue.
//   2. En cours de salve, chunks à l'heure → enchaînement EXACT (zéro gap ajouté).
//   3. Chunk en retard (la file est passée) → recalage unique à +60 ms, pas de rafale de clics.

import { describe, expect, it } from 'vitest';
import {
  computeVoiceStartTime,
  VOICE_LATE_CHUNK_LEAD_SECONDS,
  VOICE_START_LEAD_SECONDS,
} from '../src/ui/controller.mjs';

describe('computeVoiceStartTime — anti micro-coupures', () => {
  it('début de salve : coussin de 150 ms', () => {
    expect(computeVoiceStartTime({ currentTime: 10, queuedUntil: 0, queueEmpty: true }))
      .toBeCloseTo(10 + VOICE_START_LEAD_SECONDS, 5);
  });

  it('salve en cours, chunk à l\'heure : enchaînement exact sur la fin du précédent', () => {
    expect(computeVoiceStartTime({ currentTime: 10, queuedUntil: 12.4, queueEmpty: false }))
      .toBe(12.4);
  });

  it('chunk en RETARD (file passée) : recalage à +60 ms, jamais dans le passé', () => {
    expect(computeVoiceStartTime({ currentTime: 10, queuedUntil: 9.7, queueEmpty: false }))
      .toBeCloseTo(10 + VOICE_LATE_CHUNK_LEAD_SECONDS, 5);
  });

  it('le coussin de démarrage domine une file résiduelle plus courte', () => {
    expect(computeVoiceStartTime({ currentTime: 10, queuedUntil: 10.05, queueEmpty: true }))
      .toBeCloseTo(10 + VOICE_START_LEAD_SECONDS, 5);
  });

  it('constantes cohérentes : coussin de départ > recalage de retard > 20 ms historiques', () => {
    expect(VOICE_START_LEAD_SECONDS).toBeGreaterThan(VOICE_LATE_CHUNK_LEAD_SECONDS);
    expect(VOICE_LATE_CHUNK_LEAD_SECONDS).toBeGreaterThan(0.02);
    expect(VOICE_START_LEAD_SECONDS).toBeLessThanOrEqual(0.25);
  });
});
