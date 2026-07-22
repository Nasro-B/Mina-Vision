// Évaluateur d'étapes de plan : vérifie qu'une étape est RÉELLEMENT satisfaite avant de la
// marquer terminée — preuve exigée, jamais de déclaratif. Formats de vérification :
//   « tests »                 → la suite doit être verte
//   « file:chemin »           → le fichier doit exister
//   « pattern:regex:chemin »  → le fichier doit contenir le motif
//   « » (vide)                → validation manuelle exigée (jamais auto-validée)

export function createCodePlanEvaluator({ testRunner = null, fs = null } = {}) {
  async function evaluateStep(step) {
    if (!step || typeof step.verification !== 'string') {
      return Object.freeze({ satisfied: false, evidence: 'code_plan_eval_step_invalid' });
    }
    const verification = step.verification.trim();

    if (verification === '') {
      return Object.freeze({ satisfied: false, evidence: 'validation manuelle requise (aucune vérification automatique déclarée)' });
    }

    if (verification === 'tests') {
      if (!testRunner) return Object.freeze({ satisfied: false, evidence: 'test_runner_indisponible' });
      const run = await testRunner.runAll({ bail: false });
      return Object.freeze({
        satisfied: run.failed === 0 && !run.crashed && run.parsed !== false,
        evidence: `tests : ${run.passed ?? 0} verts, ${run.failed ?? 0} rouges${run.crashed ? ' (crash lanceur)' : ''}`,
      });
    }

    if (verification.startsWith('file:')) {
      if (!fs?.readFile) return Object.freeze({ satisfied: false, evidence: 'fs_indisponible' });
      const path = verification.slice('file:'.length).trim();
      try {
        await fs.readFile(path, 'utf8');
        return Object.freeze({ satisfied: true, evidence: `fichier présent : ${path}` });
      } catch {
        return Object.freeze({ satisfied: false, evidence: `fichier absent : ${path}` });
      }
    }

    if (verification.startsWith('pattern:')) {
      if (!fs?.readFile) return Object.freeze({ satisfied: false, evidence: 'fs_indisponible' });
      const rest = verification.slice('pattern:'.length);
      const separator = rest.lastIndexOf(':');
      if (separator === -1) return Object.freeze({ satisfied: false, evidence: 'code_plan_eval_pattern_invalid' });
      const patternSource = rest.slice(0, separator);
      const path = rest.slice(separator + 1).trim();
      let regex;
      try {
        regex = new RegExp(patternSource, 'u');
      } catch (error) {
        return Object.freeze({ satisfied: false, evidence: `code_plan_eval_pattern_invalid: ${error.message}` });
      }
      try {
        const content = String(await fs.readFile(path, 'utf8'));
        const match = content.match(regex);
        return match
          ? Object.freeze({ satisfied: true, evidence: `motif trouvé dans ${path} : « ${match[0].slice(0, 80)} »` })
          : Object.freeze({ satisfied: false, evidence: `motif absent de ${path}` });
      } catch {
        return Object.freeze({ satisfied: false, evidence: `fichier illisible : ${path}` });
      }
    }

    return Object.freeze({ satisfied: false, evidence: `code_plan_eval_verification_unknown: ${verification.slice(0, 60)}` });
  }

  return Object.freeze({
    evaluateStep,

    async evaluatePlan(plan) {
      if (!plan || !Array.isArray(plan.steps)) throw new Error('code_plan_eval_plan_invalid');
      const evaluations = [];
      for (const step of plan.steps) {
        if (step.status !== 'completed') continue;
        const evaluation = await evaluateStep(step);
        evaluations.push(Object.freeze({ stepId: step.id, ...evaluation }));
      }
      return Object.freeze({
        evaluations: Object.freeze(evaluations),
        allSatisfied: evaluations.every((entry) => entry.satisfied),
      });
    },
  });
}
