import { describe, expect, it } from 'vitest';
import { classifyCodeCommand, codeIntents } from '../src/code/voice/code-intent-classifier.mjs';

describe('code-intent-classifier (voix T6.1)', () => {
  it('reconnaît les 7 intents sur des formulations naturelles', () => {
    const cases = [
      ['crée-moi une API de notes', 'creer_projet'],
      ['construis un site web', 'creer_projet'],
      ['analyse le projet', 'analyser_projet'],
      ['valide le projet', 'valider_projet'],
      ['déploie le projet', 'deployer_projet'],
      ['améliore-toi', 'ameliorer_toi'],
      ['ajoute-toi l’outil météo', 'ameliorer_toi'],
      ['liste tes versions', 'lister_versions'],
      ['reviens à la version d’hier', 'restaurer_version'],
      ['restaure la version d’avant', 'restaurer_version'],
    ];
    for (const [utterance, intent] of cases) {
      expect(classifyCodeCommand(utterance)).toEqual({ intent });
    }
  });

  it('0 FAUX POSITIF sur des phrases quelconques (non-code)', () => {
    for (const u of ['quelle heure est-il', 'raconte une blague', 'appelle maman', 'ouvre youtube', 'quel temps fait-il', 'liste mes rendez-vous']) {
      expect(classifyCodeCommand(u)).toBeNull();
    }
  });

  it('« améliore-toi » ne matche pas « créer » et inversement', () => {
    expect(classifyCodeCommand('améliore ton code').intent).toBe('ameliorer_toi');
    expect(classifyCodeCommand('crée un projet cli').intent).toBe('creer_projet');
  });

  it('expose la liste des intents', () => {
    expect(codeIntents()).toEqual(expect.arrayContaining(['creer_projet', 'ameliorer_toi', 'restaurer_version']));
  });
});
