import { describe, expect, it } from 'vitest';
import { createCodeOrchestrator } from '../../src/code/code-orchestrator.mjs';
import { createCodePersonality } from '../../src/code/code-personality.mjs';
import { createCodeSafetyPolicy } from '../../src/code/code-safety-policy.mjs';
import { createMinaOrchestrator } from '../../src/core/orchestrator.mjs';

const PATCH = '*** Begin Patch\n*** Update File: src/app.mjs\n-v1\n+v2\n*** End Patch';

function buildOrchestrator({
  generations,
  verify = async () => ({ ok: true, checks: [] }),
  testRuns = [{ passed: 10, failed: 0, total: 10 }],
  confirm = async () => true,
  applyBehavior = null,
} = {}) {
  const events = [];
  const applied = [];
  const restored = [];
  const generationQueue = [...generations];
  const testQueue = [...testRuns];
  const orchestrator = createCodeOrchestrator({
    personality: createCodePersonality(),
    contextLoader: { load: async () => ({ framework: 'Electron', scripts: {}, minaMd: null }) },
    providerRouter: { route: () => ({ providerId: 'lm-studio-code', modelId: 'local', locality: 'local' }) },
    generateCode: async ({ task }) => {
      const next = generationQueue.shift() ?? { output: 'fini', patch: null };
      return typeof next === 'function' ? next({ task }) : next;
    },
    patchApplier: {
      apply: async ({ patches }) => {
        if (applyBehavior) return applyBehavior({ patches });
        applied.push(patches);
        return { applied: [{ file: 'src/app.mjs', operation: 'update' }] };
      },
    },
    verifier: { verify },
    testRunner: { runAll: async () => testQueue.shift() ?? { passed: 10, failed: 0, total: 10 } },
    safetyPolicy: createCodeSafetyPolicy(),
    fileBackup: {
      hasBackup: () => true,
      restore: async (file) => { restored.push(file); },
    },
    confirm,
    onEvent: (event) => events.push(event.type),
  });
  return { orchestrator, events, applied, restored };
}

describe('code-orchestrator', () => {
  it('exige ses dépendances, un but et une racine', async () => {
    expect(() => createCodeOrchestrator({})).toThrow(/personality_required/u);
    const { orchestrator } = buildOrchestrator({ generations: [] });
    await expect(orchestrator.run({})).rejects.toThrow(/goal_required/u);
    await expect(orchestrator.run({ goal: 'x' })).rejects.toThrow(/root_required/u);
  });

  it('mission nominale : route → génère → confirme → applique → vérifie → tests verts → completed', async () => {
    const { orchestrator, events, applied } = buildOrchestrator({
      generations: [{ output: `voici\n${PATCH}`, patch: PATCH }],
    });
    const result = await orchestrator.run({ goal: 'passer en v2', projectRoot: 'C:/p' });
    expect(result.status).toBe('completed');
    expect(result.filesChanged).toEqual(['src/app.mjs']);
    expect(result.tests).toMatchObject({ passed: 10, failed: 0 });
    expect(applied).toEqual([PATCH]);
    expect(events).toEqual([
      'code_mission_started',
      'code_provider_routed',
      'code_action_proposed',
      'code_patch_applied',
      'code_tests_run',
      'code_mission_completed',
    ]);
  });

  it('réponse en prose sans patch → completed_without_patch avec la réponse', async () => {
    const { orchestrator } = buildOrchestrator({
      generations: [{ output: 'Je ne sais pas faire cela sans plus de contexte.', patch: null }],
    });
    const result = await orchestrator.run({ goal: 'question', projectRoot: 'C:/p' });
    expect(result.status).toBe('completed_without_patch');
    expect(result.answer).toContain('Je ne sais pas');
  });

  it('confirmation refusée → failed code_confirmation_denied, patch JAMAIS appliqué', async () => {
    const { orchestrator, applied } = buildOrchestrator({
      generations: [{ output: PATCH, patch: PATCH }],
      confirm: async () => false,
    });
    const result = await orchestrator.run({ goal: 'x', projectRoot: 'C:/p' });
    expect(result).toMatchObject({ status: 'failed', reason: 'code_confirmation_denied' });
    expect(applied).toEqual([]);
  });

  it('vérification refusée → restauration des backups puis nouvelle itération avec le motif', async () => {
    const tasks = [];
    const { orchestrator, restored } = buildOrchestrator({
      generations: [
        ({ task }) => { tasks.push(task); return { output: PATCH, patch: PATCH }; },
        ({ task }) => { tasks.push(task); return { output: PATCH, patch: PATCH }; },
      ],
      verify: (() => {
        let first = true;
        return async () => {
          if (first) {
            first = false;
            return { ok: false, checks: [{ name: 'secrets:src/app.mjs', ok: false, detail: 'secret introduit' }] };
          }
          return { ok: true, checks: [] };
        };
      })(),
    });
    const result = await orchestrator.run({ goal: 'corriger', projectRoot: 'C:/p' });
    expect(result.status).toBe('completed');
    expect(result.iterations).toBe(2);
    expect(restored).toEqual(['src/app.mjs']);
    expect(tasks[1]).toContain('secret introduit');
  });

  it('tests rouges → l\'échec nourrit l\'itération suivante, vert ensuite → completed', async () => {
    const tasks = [];
    const { orchestrator } = buildOrchestrator({
      generations: [
        ({ task }) => { tasks.push(task); return { output: PATCH, patch: PATCH }; },
        ({ task }) => { tasks.push(task); return { output: PATCH, patch: PATCH }; },
      ],
      testRuns: [
        { passed: 9, failed: 1, total: 10, failures: ['tests/app.test.mjs'] },
        { passed: 10, failed: 0, total: 10 },
      ],
    });
    const result = await orchestrator.run({ goal: 'réparer', projectRoot: 'C:/p' });
    expect(result.status).toBe('completed');
    expect(result.iterations).toBe(2);
    expect(tasks[1]).toContain('tests rouges (1)');
  });

  it('patch inapplicable à chaque itération → failed avec le dernier motif', async () => {
    const { orchestrator } = buildOrchestrator({
      generations: Array(3).fill({ output: PATCH, patch: PATCH }),
      applyBehavior: () => { throw new Error('code_diff_apply_context_not_found: src/app.mjs'); },
    });
    const result = await orchestrator.run({ goal: 'x', projectRoot: 'C:/p', maxActions: 3 });
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('context_not_found');
  });

  it('stop() interrompt la mission au tour suivant', async () => {
    const { orchestrator } = buildOrchestrator({
      generations: [
        () => { orchestrator.stop(); return { output: PATCH, patch: PATCH }; },
        { output: PATCH, patch: PATCH },
      ],
      testRuns: [{ passed: 9, failed: 1, total: 10, failures: [] }],
    });
    const result = await orchestrator.run({ goal: 'x', projectRoot: 'C:/p' });
    expect(result.status).toBe('stopped');
  });

  it('refuse deux missions simultanées', async () => {
    const { orchestrator } = buildOrchestrator({
      generations: [async () => new Promise((resolve) => setTimeout(() => resolve({ output: 'fin', patch: null }), 30))],
    });
    const first = orchestrator.run({ goal: 'a', projectRoot: 'C:/p' });
    await expect(orchestrator.run({ goal: 'b', projectRoot: 'C:/p' })).rejects.toThrow(/busy/u);
    await first;
  });
});

describe('createMinaOrchestrator — domaine code additif', () => {
  it('sans domain, comportement historique intact (signature inchangée)', () => {
    const orchestrator = createMinaOrchestrator({});
    expect(typeof orchestrator.run).toBe('function');
    expect(typeof orchestrator.emergencyStop).toBe('function');
  });

  it('domain=code sans codeOrchestrator → erreur nominée', async () => {
    const orchestrator = createMinaOrchestrator({ domain: 'code' });
    await expect(orchestrator.run({ goal: 'x' })).rejects.toThrow(/code_orchestrator_missing/u);
  });

  it('domain=code délègue run au codeOrchestrator avec les paramètres code', async () => {
    const received = [];
    const orchestrator = createMinaOrchestrator({
      domain: 'code',
      codeOrchestrator: {
        run: async (params) => { received.push(params); return { status: 'completed' }; },
        stop: () => {},
      },
    });
    const result = await orchestrator.run({ goal: 'refactor', mode: 'local-only', projectRoot: 'C:/p', maxActions: 5 });
    expect(result.status).toBe('completed');
    expect(received[0]).toMatchObject({ goal: 'refactor', mode: 'local-only', projectRoot: 'C:/p', maxActions: 5 });
  });

  it('emergencyStop stoppe aussi la mission code, sans jamais échouer', async () => {
    let stopped = false;
    const orchestrator = createMinaOrchestrator({
      domain: 'code',
      codeOrchestrator: { run: async () => ({}), stop: () => { stopped = true; } },
    });
    await orchestrator.emergencyStop();
    expect(stopped).toBe(true);

    const throwing = createMinaOrchestrator({
      domain: 'code',
      codeOrchestrator: { run: async () => ({}), stop: () => { throw new Error('boom'); } },
    });
    await expect(throwing.emergencyStop()).resolves.toBeTruthy();
  });
});
