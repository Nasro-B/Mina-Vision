// Cycle de vie T3.2 (SPEC agente-codage V3) : pipeline unique « valider ce projet » — install → lint →
// typecheck → tests → build. Chaque étape via run-command borné, avec rapport PAR ÉTAPE. Distinction
// stricte « échoué » (a tourné et a raté) vs « absent » (pas de script → sauté, pas un échec). JAMAIS
// « validé » si les tests n'ont pas réellement tourné et réussi — on dit toujours quelles étapes ont
// tourné. Injectable (runCommand) → testable sans install ni build.

// Étapes optionnelles pilotées par la présence du script npm ; install et test sont particuliers.
const OPTIONAL_STEPS = Object.freeze(['lint', 'typecheck', 'build']);

export function createValidationPipeline({ runCommand } = {}) {
  if (typeof runCommand !== 'function') throw new TypeError('validation_pipeline_run_required');

  async function runStep(name, args, dir) {
    const result = await runCommand({ command: 'npm', args, cwd: dir });
    return { name, status: Number(result?.code ?? 0) === 0 ? 'ok' : 'échoué' };
  }

  return Object.freeze({
    async validate({ dir, scripts = [] } = {}) {
      if (!dir) throw new TypeError('validation_pipeline_dir_required');
      const steps = [];

      steps.push(await runStep('install', ['install'], dir));

      for (const script of OPTIONAL_STEPS) {
        if (script === 'typecheck' ? !scripts.includes('typecheck') : !scripts.includes(script)) {
          steps.push({ name: script, status: 'absent' }); // sauté, jamais compté comme échec
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        steps.push(await runStep(script, ['run', script], dir));
      }

      // Les tests DOIVENT tourner : un projet sans script test ne peut pas être « validé ».
      const testStep = scripts.includes('test')
        ? await runStep('test', ['test'], dir)
        : { name: 'test', status: 'absent' };
      steps.splice(4, 0, testStep); // ordre lisible : install, lint, typecheck, build, test → réordonné ci-dessous

      // Réordonne dans l'ordre canonique pour le rapport.
      const order = ['install', 'lint', 'typecheck', 'test', 'build'];
      steps.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

      const failed = steps.some((s) => s.status === 'échoué');
      const testOk = steps.find((s) => s.name === 'test')?.status === 'ok';
      const anyAbsent = steps.some((s) => s.status === 'absent');
      const validated = !failed && testOk;
      const status = failed || !testOk ? 'red' : (anyAbsent ? 'partial' : 'green');

      return Object.freeze({ validated, status, steps: Object.freeze(steps), report: describe(steps, status) });
    },
  });
}

export function describe(steps, status) {
  const parts = steps.map((s) => `${s.name}:${s.status}`).join(', ');
  const verdict = status === 'green' ? 'VALIDÉ (complet)'
    : status === 'partial' ? 'validé, mais des étapes étaient absentes'
      : 'NON validé';
  return `${verdict} — ${parts}.`;
}
