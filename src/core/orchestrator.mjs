import {
  completeMission,
  createMission,
  recordAction,
  recordFailure,
  stopMission,
} from './mission-state.mjs';
import { normalizeAction } from '../executors/action-normalizer.mjs';
import { classifyAction } from '../safety/policy.mjs';
import { verifyAction } from '../grounding/action-verifier.mjs';
import { withRetry } from './error-resilience.mjs';

export function createMinaOrchestrator({
  computerUse,
  executors,
  confirm = async () => false,
  onEvent = () => {},
  actionVerifier = verifyAction,
  retryOptions = {},
  // Domaine « code » (Mina Code) : purement additif — sans ces deux paramètres, le
  // comportement historique est strictement identique.
  domain = 'general',
  codeOrchestrator = null,
} = {}) {
  let activeExecutor = null;
  let running = false;
  let stopRequested = false;
  // Owner voice lines spoken DURING a mission ("cherche X", "descends", "clique là") — consumed by
  // the next model turn so the running mission is steered instead of a second one being started.
  let pendingGuidance = [];

  const emit = (type, payload = {}) => onEvent({ type, ...payload });
  // Resilience wrapper for IDEMPOTENT calls only (observe, model turns): transient faults retry
  // with backoff; safety refusals and permanent errors surface immediately. executor.execute is
  // deliberately NOT wrapped — an action crash may have landed after its effect, so it is turned
  // into a clean failed result for the model to react to, never blind-retried.
  const resilient = (label, fn) => withRetry(fn, {
    ...retryOptions,
    onRetry: ({ attempt, delayMs, error }) => emit('resilience_retry', { operation: label, attempt, delayMs, error: error.message }),
  });
  const hideCursor = async (executor) => {
    if (typeof executor?.hideCursor !== 'function') return;
    try {
      await executor.hideCursor();
    } catch (error) {
      emit('cursor_error', { error: error.message });
    }
  };

  return Object.freeze({
    run: async ({
      goal,
      evidence = [],
      environment = 'browser',
      mode = 'auto',
      offline = false,
      preferredProvider,
      maxActions = 40,
      timeoutMs = 900_000,
      ...codeParams
    }) => {
      // Pipeline développeur : délégation intégrale à l'orchestrateur code injecté.
      if (domain === 'code') {
        if (!codeOrchestrator || typeof codeOrchestrator.run !== 'function') {
          throw new Error('code_orchestrator_missing');
        }
        return codeOrchestrator.run({ goal, mode, maxActions, ...codeParams });
      }
      if (running) throw new Error('Mina exécute déjà une mission.');
      const executor = executors?.[environment];
      if (!executor) throw new Error(`Exécuteur indisponible: ${environment}`);
      if (!computerUse?.start || !computerUse?.continue) throw new Error('Computer Use indisponible.');

      running = true;
      stopRequested = false;
      activeExecutor = executor;
      let state = createMission({ goal, mode: environment === 'browser' ? 'general' : 'general', maxActions, timeoutMs });
      emit('mission_started', { state, environment });

      try {
        let observation = await resilient('observe', () => executor.observe());
        let response = await resilient('model_start', () => computerUse.start({
          goal, evidence, environment, observation, mode, offline, preferredProvider,
        }));
        let pendingUnverifiedAction = false;

        while (state.status === 'running') {
          if (stopRequested) {
            state = stopMission(state, 'emergency_stop');
            break;
          }
          if (response.completed) {
            state = pendingUnverifiedAction
              ? stopMission(state, 'action_unverified')
              : completeMission(state, response.text || 'Terminé');
            break;
          }

          const functionCall = response.calls?.[0];
          if (!functionCall) {
            state = recordFailure(state, 'Réponse Gemini sans action.');
            continue;
          }

          let action;
          try {
            action = normalizeAction(functionCall, observation);
          } catch (error) {
            state = recordFailure(state, error.message);
            emit('action_rejected', { error: error.message, state });
            if (state.status !== 'running') break;
            observation = await resilient('observe', () => executor.observe());
            const rejectedCall = { interactionId: response.interactionId, call: functionCall, actionResult: { executed: false, error: error.message }, observation, environment };
            response = await resilient('model_continue', () => computerUse.continue(rejectedCall));
            continue;
          }

          if (action.name === 'done') {
            state = completeMission(state, response.text || 'Terminé');
            break;
          }

          const context = typeof executor.currentContext === 'function'
            ? await executor.currentContext()
            : { app: environment };
          const safety = classifyAction(action, context);
          emit('action_proposed', { action, safety, state });

          if (typeof executor.previewAction === 'function') {
            try {
              await executor.previewAction(action, { environment, safety });
              emit('cursor_visible', { action: action.name, safety: safety.decision });
            } catch (error) {
              emit('cursor_error', { error: error.message });
            }
          }

          if (safety.decision === 'block') {
            await hideCursor(executor);
            state = stopMission(state, 'safety_blocked');
            break;
          }

          let rawActionResult;
          let confirmationRefused = false;
          try {
            if (safety.decision === 'confirm') {
              const approved = await confirm({ action, context, reason: safety.reason });
              rawActionResult = approved
                ? { ...(await executor.execute(action)), safetyAcknowledgement: true }
                : { executed: false, error: 'confirmation_refused' };
              confirmationRefused = !approved;
            } else {
              rawActionResult = await executor.execute(action);
            }
          } catch (error) {
            // An action crash is NOT blind-retried (its effect may have landed before the throw):
            // it becomes a clean failed result the model sees and works around, instead of killing
            // the whole mission as a runtime_error.
            rawActionResult = { executed: false, error: error.message };
            emit('action_error', { action, error: error.message });
          } finally {
            // The overlay must not become false evidence in the post-action observation.
            await hideCursor(executor);
          }

          const afterObservation = await resilient('observe', () => executor.observe());
          const verification = actionVerifier({
            action,
            before: observation,
            result: rawActionResult,
            after: afterObservation,
            expectedEffect: action.expectedEffect,
          });
          const actionResult = {
            ...rawActionResult,
            attempted: rawActionResult.executed === true,
            executed: verification.status === 'verified',
            verification,
          };

          if (verification.status === 'verified') {
            state = recordAction(state);
            pendingUnverifiedAction = false;
            emit('action_completed', { action, actionResult, state });
          } else if (confirmationRefused) {
            pendingUnverifiedAction = false;
            emit('action_rejected', { action, actionResult, state });
          } else {
            state = recordFailure(state, verification.reason);
            pendingUnverifiedAction = true;
            emit('action_unverified', { action, actionResult, state });
          }
          if (state.status !== 'running') break;

          observation = afterObservation;
          const guidance = pendingGuidance.splice(0).join(' ');
          const continuePayload = {
            interactionId: response.interactionId,
            call: functionCall,
            actionResult,
            observation,
            environment,
            ...(guidance ? { guidance } : {}),
          };
          response = await resilient('model_continue', () => computerUse.continue(continuePayload));
        }

        emit('mission_finished', { state });
        return state;
      } catch (error) {
        if (state.status === 'running') state = stopMission(state, 'runtime_error');
        emit('mission_error', { error: error.message, state });
        throw Object.assign(error, { missionState: state });
      } finally {
        await hideCursor(executor);
        running = false;
        activeExecutor = null;
        pendingGuidance = [];
      }
    },
    pushGuidance: (text) => {
      const line = String(text ?? '').trim();
      if (!running || !line) return false;
      pendingGuidance.push(line);
      emit('guidance_queued', { text: line });
      return true;
    },
    emergencyStop: async () => {
      stopRequested = true;
      emit('emergency_stop');
      // L'arrêt d'urgence prime sur tout — y compris une mission code en cours.
      if (codeOrchestrator?.stop) {
        try {
          codeOrchestrator.stop();
        } catch {
          // L'arrêt d'urgence ne doit jamais échouer à cause du domaine code.
        }
      }
      await hideCursor(activeExecutor);
      if (activeExecutor?.emergencyStop) return activeExecutor.emergencyStop();
      const releasers = Object.values(executors ?? {})
        .filter((executor) => typeof executor.emergencyStop === 'function')
        .map((executor) => executor.emergencyStop());
      await Promise.allSettled(releasers);
      return { released: releasers.length > 0 };
    },
    isRunning: () => running,
  });
}
