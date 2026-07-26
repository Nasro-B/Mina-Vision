// Garde anti-écho de la propre voix de Mina (cause réelle 2026-07-25) : ses répliques revenaient
// par le micro comme énoncés utilisateur, la couche dialogue y lisait verbe+surface et lançait des
// missions navigateur fantômes (« la mission a échoué » sans aucune demande). Ces tests verrouillent
// le contrat : l'écho est jeté, une VRAIE commande — même prononcée pendant que Mina parle — passe.

import { describe, expect, it } from 'vitest';
import { createEchoGuard } from '../src/voice/echo-guard.mjs';

const at = (start = 0) => {
  let current = start;
  return { now: () => current, advance: (ms) => { current += ms; } };
};

describe('createEchoGuard: détection d’écho', () => {
  it('jette la réplique exacte de Mina revenue par le micro', () => {
    const guard = createEchoGuard({ now: () => 0 });
    guard.record('Je cherche sur le web, Nasro.');
    expect(guard.isEcho('je cherche sur le web nasro')).toBe(true);
  });

  it('jette un écho partiel largement recouvrant (la fin de la phrase seulement)', () => {
    const guard = createEchoGuard({ now: () => 0 });
    guard.record("J'ouvre la page YouTube et je lance la recherche demandée maintenant.");
    expect(guard.isEcho('je lance la recherche demandée maintenant')).toBe(true);
  });

  it('laisse passer une vraie commande pendant que Mina parle (mots différents)', () => {
    const guard = createEchoGuard({ now: () => 0 });
    guard.record('Voici les actualités du jour : la météo est ensoleillée à Alger.');
    expect(guard.isEcho('ouvre youtube sur le navigateur')).toBe(false);
  });

  it('ne bloque jamais un énoncé court (« oui », « stop », « mets la musique »)', () => {
    const guard = createEchoGuard({ now: () => 0 });
    guard.record('Oui, je mets la musique tout de suite sur la page.');
    expect(guard.isEcho('oui')).toBe(false);
    expect(guard.isEcho('stop')).toBe(false);
    // 2 mots significatifs (« mets » ne compte pas : la garde exige ≥ 3) → jamais un écho.
    expect(guard.isEcho('mets la musique')).toBe(false);
  });

  it('normalise accents, casse et ponctuation avant de comparer', () => {
    const guard = createEchoGuard({ now: () => 0 });
    guard.record('Je démarre la RECHERCHE méteo, créateur !');
    expect(guard.isEcho('je demarre la recherche meteo createur')).toBe(true);
  });

  it('sous le seuil de recouvrement, l’énoncé est routé normalement', () => {
    const guard = createEchoGuard({ threshold: 0.7, now: () => 0 });
    guard.record('Je regarde la météo du jour.');
    // « regarde » et « météo » recouvrent, « cherche/videos/youtube » non → 2/5 < 0.7.
    expect(guard.isEcho('regarde la météo cherche des videos youtube')).toBe(false);
  });
});

describe('createEchoGuard: fenêtre temporelle', () => {
  it('un écho expiré (fenêtre dépassée) n’est plus un écho', () => {
    const clock = at(0);
    const guard = createEchoGuard({ windowMs: 15_000, now: clock.now });
    guard.record('Je cherche sur le web, Nasro.');
    clock.advance(15_001);
    expect(guard.isEcho('je cherche sur le web nasro')).toBe(false);
  });

  it('dans la fenêtre, l’écho reste détecté même après plusieurs secondes', () => {
    const clock = at(0);
    const guard = createEchoGuard({ windowMs: 15_000, now: clock.now });
    guard.record('Je cherche sur le web, Nasro.');
    clock.advance(10_000);
    expect(guard.isEcho('je cherche sur le web nasro')).toBe(true);
  });

  it('reset() vide la fenêtre immédiatement', () => {
    const guard = createEchoGuard({ now: () => 0 });
    guard.record('Je cherche sur le web, Nasro.');
    guard.reset();
    expect(guard.isEcho('je cherche sur le web nasro')).toBe(false);
  });
});

describe('createEchoGuard: robustesse', () => {
  it('les fragments streaming ré-enregistrés (buffer croissant) couvrent la phrase entière', () => {
    const guard = createEchoGuard({ now: () => 0 });
    // onModelTranscript enregistre le buffer COMPLET à chaque fragment — les surensembles
    // successifs ne cassent rien et la phrase finale est couverte.
    guard.record('Je cher');
    guard.record('Je cherche sur');
    guard.record('Je cherche sur le web, Nasro.');
    expect(guard.isEcho('je cherche sur le web nasro')).toBe(true);
  });

  it('borne le nombre d’entrées (maxEntries) sans perdre les plus récentes', () => {
    const guard = createEchoGuard({ maxEntries: 5, now: () => 0 });
    for (let index = 0; index < 50; index += 1) guard.record(`phrase numero ${index} sans importance`);
    guard.record('Je cherche sur le web, Nasro.');
    expect(guard.isEcho('je cherche sur le web nasro')).toBe(true);
  });

  it('texte vide / null : record ne stocke rien, isEcho reste faux', () => {
    const guard = createEchoGuard({ now: () => 0 });
    guard.record('');
    guard.record(null);
    expect(guard.isEcho('je cherche sur le web nasro')).toBe(false);
  });
});
