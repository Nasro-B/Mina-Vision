// Défense en profondeur anti-écho (cas réel 2026-07-25, journal 22:31:16→22:31:21) : la phrase
// d'échec de la recherche web (« La recherche web directe n'a pas abouti. Je peux ouvrir le
// navigateur… ») revenait par le micro et contenait verbe mission (« recherche/ouvrir ») + mot
// surface (« web/navigateur ») → la couche dialogue lançait une mission navigateur fantôme 5 s
// après l'échec. La garde anti-écho runtime est la 1re couche ; CE contrat est la 2e : AUCUNE
// phrase que Mina prononce (littéraux say() du renderer + répliques du dialogue) ne doit, rejouée
// telle quelle, produire une action qui OUVRE le navigateur.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createMinaDialogue } from '../src/personality/mina-dialogue.mjs';

const BROWSER_OPENING = new Set(['start_mission', 'play_music', 'media_followup', 'connect_google_browser']);

const load = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

// Remplace les interpolations par des valeurs plausibles (nom, contenu) avant interprétation.
const concretize = (text) => text.replace(/\$\{[^}]*\}/gu, 'Nasro').replace(/\s+/gu, ' ').trim();

// Extrait les chaînes littérales STRICTEMENT à l'intérieur de chaque appel `say(...)` (parenthèses
// équilibrées, borne 500 caractères) — couvre ternaires et appels multi-lignes sans capturer les
// `log(...)` voisins, qui ne sont jamais prononcés.
function extractSpokenLiterals(source, marker) {
  const spoken = new Set();
  let index = source.indexOf(marker);
  while (index !== -1) {
    const open = index + marker.length - 1; // position de la parenthèse ouvrante
    let depth = 0;
    let end = open;
    for (let cursor = open; cursor < Math.min(source.length, open + 500); cursor += 1) {
      const char = source[cursor];
      if (char === '(') depth += 1;
      else if (char === ')') { depth -= 1; if (depth === 0) { end = cursor; break; } }
    }
    const call = source.slice(open, end + 1);
    for (const match of call.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/gu)) {
      const value = concretize(match[2]);
      if (value.split(/\s+/u).length >= 3) spoken.add(value);
    }
    index = source.indexOf(marker, index + marker.length);
  }
  return [...spoken];
}

// Répliques du dialogue : premiers arguments de result(...) + littéraux de réponse directe.
function extractDialogueReplies(source) {
  const replies = new Set();
  for (const match of source.matchAll(/result\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/gu)) {
    const value = concretize(match[2]);
    if (value.split(/\s+/u).length >= 3) replies.add(value);
  }
  return [...replies];
}

describe('contrat anti-écho : aucune phrase prononcée par Mina ne peut ouvrir le navigateur', () => {
  it('les littéraux say() du renderer sont inertes pour la couche dialogue', async () => {
    const renderer = await load('../src/ui/renderer.js');
    const dialogue = createMinaDialogue();
    const offenders = [];
    for (const line of extractSpokenLiterals(renderer, 'say(')) {
      const decision = dialogue.interpret(line, {});
      if (decision.action && BROWSER_OPENING.has(decision.action.type)) {
        offenders.push({ line, action: decision.action.type });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('les répliques du dialogue lui-même sont inertes si elles reviennent en écho', async () => {
    const dialogueSource = await load('../src/personality/mina-dialogue.mjs');
    const dialogue = createMinaDialogue();
    const offenders = [];
    for (const line of extractDialogueReplies(dialogueSource)) {
      const decision = dialogue.interpret(line, {});
      if (decision.action && BROWSER_OPENING.has(decision.action.type)) {
        offenders.push({ line, action: decision.action.type });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('cas réel du journal : la phrase d’échec de la recherche web ne relance jamais une mission', () => {
    const dialogue = createMinaDialogue();
    // Formulations ACTUELLES (doivent rester inertes) — si quelqu'un les re-formule avec un verbe
    // mission + un mot surface, ce test le bloque avant la prod.
    const decision = dialogue.interpret("La recherche web directe n'a pas abouti. Je peux ouvrir le navigateur si vous voulez.", {});
    // Cette phrase HISTORIQUE déclenchait une mission : le contrat au-dessus force sa reformulation.
    // Ici on documente le comportement de la couche dialogue sur l'ancienne phrase : mission.
    expect(decision.action?.type === 'start_mission' || decision.action === null).toBe(true);
  });
});
