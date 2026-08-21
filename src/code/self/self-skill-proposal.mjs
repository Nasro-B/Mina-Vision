// Auto-modification T4.5 (SPEC agente-codage V4) : quand Mina veut se créer un skill, le flux self passe
// par le générateur de skills EXISTANT — l'auto-modification n'ouvre AUCUNE seconde porte de création. Mina
// PROPOSE, le générateur existant VALIDE (mêmes refus : imbrication, manifeste faux…), Nasro CONFIRME, le
// registre charge. Ce module ne réimplémente RIEN : il délègue toute la validation au générateur injecté.
// Injectable → testable sans le vrai générateur.

export function createSelfSkillProposal({ skillGenerator, confirm, registry } = {}) {
  if (typeof skillGenerator?.generate !== 'function' || typeof confirm !== 'function' || typeof registry?.load !== 'function') {
    throw new TypeError('self_skill_proposal_dependencies_required');
  }

  return Object.freeze({
    async propose({ spec } = {}) {
      if (!spec?.name) throw new TypeError('self_skill_spec_required');

      // Validation DÉLÉGUÉE au générateur existant : mêmes refus (imbrication, manifeste faux), jamais
      // un chemin de création parallèle.
      const validated = await skillGenerator.generate(spec);
      if (validated?.valid !== true) {
        return Object.freeze({ created: false, reason: validated?.reason ?? 'generateur_refuse' });
      }

      // Confirmation locale explicite (comme toute modification self).
      if ((await confirm({ reason: `Créer le skill « ${spec.name} » ?`, skill: spec.name })) !== true) {
        return Object.freeze({ created: false, reason: 'refused' });
      }

      await registry.load(validated);
      return Object.freeze({ created: true, skill: validated.name ?? spec.name });
    },
  });
}
