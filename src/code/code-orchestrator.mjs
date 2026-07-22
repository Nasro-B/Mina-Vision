// Orchestrateur du domaine « code » : même philosophie que l'orchestrateur général de Mina
// (le modèle PROPOSE, l'orchestrateur normalise → classe → confirme → exécute → VÉRIFIE),
// appliquée au pipeline développeur. Boucle bornée, arrêt d'urgence, événements émis.

import { normalizeCodeAction } from './code-action-normalizer.mjs';

export function createCodeOrchestrator({
  personality,
  contextLoader,
  providerRouter,
  generateCode,
  patchApplier,
  verifier,
  testRunner = null,
  safetyPolicy,
  fileBackup = null,
  confirm = async () => false,
  onEvent = () => {},
} = {}) {
  if (!personality) throw new TypeError('code_orchestrator_personality_required');
  if (!contextLoader) throw new TypeError('code_orchestrator_context_loader_required');
  if (!providerRouter) throw new TypeError('code_orchestrator_router_required');
  if (typeof generateCode !== 'function') throw new TypeError('code_orchestrator_generate_required');
  if (!patchApplier) throw new TypeError('code_orchestrator_applier_required');
  if (!verifier) throw new TypeError('code_orchestrator_verifier_required');
  if (!safetyPolicy) throw new TypeError('code_orchestrator_safety_required');

  let running = false;
  let stopRequested = false;
  const emit = (type, payload = {}) => onEvent({ type, ...payload });

  return Object.freeze({
    stop() {
      stopRequested = true;
    },

    async run({
      goal,
      projectRoot,
      mode = 'auto',
      maxActions = 10,
      runTestsAfterEachPatch = true,
    } = {}) {
      if (typeof goal !== 'string' || goal.trim().length === 0) throw new Error('code_orchestrator_goal_required');
      if (typeof projectRoot !== 'string' || projectRoot.length === 0) throw new Error('code_orchestrator_root_required');
      if (running) throw new Error('code_orchestrator_busy');
      running = true;
      stopRequested = false;

      const history = [];
      const filesChanged = new Set();
      try {
        const projectContext = await contextLoader.load(projectRoot);
        const systemPrompt = personality.buildSystemPrompt({ projectContext, mode });
        emit('code_mission_started', { goal, mode, framework: projectContext.framework });

        let lastFailure = null;
        const bounded = Math.min(Math.max(1, Number(maxActions) || 10), 40);

        for (let iteration = 1; iteration <= bounded; iteration += 1) {
          if (stopRequested) {
            emit('code_mission_stopped', { iteration });
            return Object.freeze({ status: 'stopped', iterations: iteration - 1, filesChanged: [...filesChanged], history: Object.freeze(history) });
          }

          const route = providerRouter.route({ task: goal, mode });
          emit('code_provider_routed', { providerId: route.providerId, modelId: route.modelId, locality: route.locality });

          const generation = await generateCode({
            route,
            task: lastFailure ? `${goal}\n\nÉchec précédent à corriger :\n${lastFailure}` : goal,
            systemPrompt,
            projectContext,
          });
          history.push({ iteration, providerId: route.providerId, hasPatch: Boolean(generation.patch) });

          if (!generation.patch) {
            // Le modèle a répondu en prose : soit une réponse finale, soit un refus.
            emit('code_mission_completed', { iteration, answer: generation.output?.slice(0, 2_000) ?? '' });
            return Object.freeze({
              status: 'completed_without_patch',
              answer: generation.output ?? '',
              iterations: iteration,
              filesChanged: [...filesChanged],
              history: Object.freeze(history),
            });
          }

          const action = normalizeCodeAction({ type: 'code.diff.apply', arguments: { patch: generation.patch, intent: goal.slice(0, 200) } });
          const safety = safetyPolicy.classifyAction(action, { projectRoot });
          emit('code_action_proposed', { decision: safety.decision, reason: safety.reason, iteration });
          if (safety.decision === 'block') {
            return Object.freeze({
              status: 'failed',
              reason: `action bloquée : ${safety.reason}`,
              iterations: iteration,
              filesChanged: [...filesChanged],
              history: Object.freeze(history),
            });
          }
          if (safety.decision === 'confirm') {
            const accepted = await confirm({ action: 'code.diff.apply', detail: generation.patch.slice(0, 4_000), safety });
            if (accepted !== true) {
              emit('code_action_denied', { iteration });
              return Object.freeze({
                status: 'failed',
                reason: 'code_confirmation_denied',
                iterations: iteration,
                filesChanged: [...filesChanged],
                history: Object.freeze(history),
              });
            }
          }

          let applied;
          try {
            applied = await patchApplier.apply({ patches: generation.patch, backup: true, reformat: false, lint: false });
          } catch (error) {
            lastFailure = `application du patch impossible : ${error.message}`;
            emit('code_patch_failed', { iteration, error: error.message });
            continue;
          }
          const touched = applied.applied.map((entry) => entry.file);
          for (const file of touched) filesChanged.add(file);
          emit('code_patch_applied', { iteration, files: touched });

          const verification = await verifier.verify({ action, files: touched, runTests: false });
          if (!verification.ok) {
            const failedChecks = verification.checks.filter((entry) => !entry.ok).map((entry) => `${entry.name}: ${entry.detail}`);
            if (fileBackup) {
              for (const file of touched) {
                if (fileBackup.hasBackup(file)) await fileBackup.restore(file).catch(() => {});
              }
            }
            lastFailure = `vérification refusée — ${failedChecks.join(' | ')}`;
            emit('code_verification_failed', { iteration, checks: failedChecks });
            continue;
          }

          if (runTestsAfterEachPatch && testRunner) {
            const run = await testRunner.runAll({ bail: false });
            emit('code_tests_run', { iteration, passed: run.passed, failed: run.failed });
            if (run.failed > 0 || run.crashed) {
              lastFailure = `tests rouges (${run.failed}) : ${(run.failures ?? []).slice(0, 3).join(' ; ')}`;
              continue;
            }
            emit('code_mission_completed', { iteration, files: [...filesChanged] });
            return Object.freeze({
              status: 'completed',
              iterations: iteration,
              filesChanged: [...filesChanged],
              tests: Object.freeze({ passed: run.passed, failed: run.failed, total: run.total }),
              history: Object.freeze(history),
            });
          }

          emit('code_mission_completed', { iteration, files: [...filesChanged] });
          return Object.freeze({
            status: 'completed',
            iterations: iteration,
            filesChanged: [...filesChanged],
            tests: null,
            history: Object.freeze(history),
          });
        }

        return Object.freeze({
          status: 'failed',
          reason: `toujours pas vert après ${bounded} itération(s) — ${lastFailure ?? 'aucun patch abouti'}`,
          iterations: bounded,
          filesChanged: [...filesChanged],
          history: Object.freeze(history),
        });
      } finally {
        running = false;
      }
    },
  });
}
