import { describe, expect, it } from 'vitest';
import { isWakeExemptTool, shouldRefuseVoiceAction, WAKE_EXEMPT_TOOL_NAMES } from '../src/voice/voice-action-gate.mjs';

describe('voice-action-gate — T3.1 gate d\'éveil des outils vocaux', () => {
  it('un outil de LECTURE / config anodine n\'exige jamais l\'éveil', () => {
    for (const tool of ['voir_camera', 'lire_journal', 'chercher_dans_le_code', 'recherche_web', 'theme', 'selectionner_environnement']) {
      expect(isWakeExemptTool(tool), tool).toBe(true);
      expect(shouldRefuseVoiceAction(tool, false), `${tool} sans éveil`).toBe(false);
      expect(shouldRefuseVoiceAction(tool, true), `${tool} avec éveil`).toBe(false);
    }
  });

  it('une ACTION à effet réel est refusée sans éveil, permise avec éveil', () => {
    for (const tool of ['lancer_mission', 'piloter_page', 'jouer_musique', 'generer_document', 'utiliser_skill', 'envoyer_email', 'creer_tache_google', 'camera']) {
      expect(isWakeExemptTool(tool), tool).toBe(false);
      expect(shouldRefuseVoiceAction(tool, false), `${tool} sans éveil → refusé`).toBe(true);
      expect(shouldRefuseVoiceAction(tool, true), `${tool} avec éveil → permis`).toBe(false);
    }
  });

  it('« ouvre youtube » (lancer_mission) sans éveil → refusé (acceptation du plan)', () => {
    expect(shouldRefuseVoiceAction('lancer_mission', false)).toBe(true);
    expect(shouldRefuseVoiceAction('lancer_mission', true)).toBe(false);
  });

  it('FAIL-CLOSED : un outil INCONNU (ajouté demain sans classement) est gardé par défaut', () => {
    expect(isWakeExemptTool('outil_futur_dangereux')).toBe(false);
    expect(shouldRefuseVoiceAction('outil_futur_dangereux', false), 'inconnu sans éveil → refusé').toBe(true);
    expect(shouldRefuseVoiceAction('outil_futur_dangereux', true), 'inconnu avec éveil → permis').toBe(false);
  });

  it('une valeur d\'éveil autre que `true` (undefined/null) est traitée comme « pas d\'éveil »', () => {
    // Sécurité : seule la valeur booléenne `true` autorise une action.
    expect(shouldRefuseVoiceAction('lancer_mission', undefined)).toBe(true);
    expect(shouldRefuseVoiceAction('lancer_mission', null)).toBe(true);
    expect(shouldRefuseVoiceAction('lancer_mission', 1)).toBe(true);
  });

  it('la liste d\'exemption est gelée (dérive attrapée par le contrat)', () => {
    // Si un futur changement ajoute/retire un outil exempté, ce test le rend visible — la liste
    // est une frontière de sécurité, pas un détail d'implémentation.
    expect([...WAKE_EXEMPT_TOOL_NAMES].sort()).toEqual([
      'analyser_le_code', 'chercher_contact', 'chercher_dans_le_code', 'lancer_les_tests_du_projet',
      'lire_erreurs_techniques', 'lire_journal', 'recherche_web', 'revue_du_code',
      'selectionner_environnement', 'statut_git_du_projet', 'theme', 'voir_camera',
    ]);
  });
});
