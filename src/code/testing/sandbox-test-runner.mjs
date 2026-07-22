// Exécution de tests dans Windows Sandbox jetable — via le backend sandbox RÉEL de Mina Vision
// (src/sandbox/windows-sandbox.mjs : detect()/execute()).
//
// CONTRAINTE STRUCTURELLE (MINA.md, section Sandbox) : le réseau est COUPÉ dans l'invité.
// `npm install` y est donc impossible — le workspace préparé DOIT contenir node_modules
// pré-copié depuis l'hôte. C'est le rôle du workspaceBuilder injecté ; sans lui, ce module
// répond sandbox_unavailable au lieu de prétendre pouvoir exécuter.

import { parseTestOutput } from './test-parser.mjs';

export function createSandboxTestRunner({
  sandboxBackend = null,
  workspaceBuilder = null,
  resultReader = null,
  now = Date.now,
} = {}) {
  return Object.freeze({
    async availability() {
      if (!sandboxBackend || typeof sandboxBackend.detect !== 'function') {
        return Object.freeze({ available: false, reason: 'sandbox_backend_missing' });
      }
      return sandboxBackend.detect();
    },

    async run({ testFiles = [], timeout = 300_000, framework = 'vitest' } = {}) {
      if (!sandboxBackend || typeof sandboxBackend.execute !== 'function') {
        return Object.freeze({ status: 'sandbox_unavailable', reason: 'sandbox_backend_missing' });
      }
      const availability = await sandboxBackend.detect();
      if (!availability.available) {
        return Object.freeze({ status: 'sandbox_unavailable', reason: availability.reason });
      }
      if (!workspaceBuilder || typeof workspaceBuilder.prepare !== 'function') {
        // Sans préparation de workspace (sources + node_modules pré-copiés), l'invité sans
        // réseau ne peut rien exécuter : on le dit, on n'invente pas.
        return Object.freeze({ status: 'sandbox_unavailable', reason: 'sandbox_workspace_builder_missing' });
      }

      const jobId = `mina-tests-${now()}`;
      let workspace;
      try {
        workspace = await workspaceBuilder.prepare({
          jobId,
          testFiles: [...testFiles],
          includeNodeModules: true, // réseau coupé dans l'invité — obligatoire
        });
      } catch (error) {
        return Object.freeze({ status: 'sandbox_workspace_failed', reason: String(error.message ?? error) });
      }

      try {
        await sandboxBackend.execute({
          jobId,
          job: { limits: { wallMs: Math.min(Math.max(30_000, Number(timeout) || 300_000), 900_000) } },
          workspace,
        });
        if (!resultReader || typeof resultReader.read !== 'function') {
          return Object.freeze({ status: 'completed_no_result_reader', jobId });
        }
        const output = await resultReader.read({ jobId, outPath: workspace.outPath });
        const parsed = parseTestOutput(output, { framework });
        return Object.freeze({ status: 'completed', jobId, ...parsed });
      } catch (error) {
        const message = String(error.message ?? error);
        if (message.startsWith('sandbox_unavailable')) {
          return Object.freeze({ status: 'sandbox_unavailable', reason: message });
        }
        return Object.freeze({ status: 'sandbox_failed', reason: message, jobId });
      } finally {
        await workspaceBuilder.cleanup?.({ jobId }).catch?.(() => {});
      }
    },
  });
}
