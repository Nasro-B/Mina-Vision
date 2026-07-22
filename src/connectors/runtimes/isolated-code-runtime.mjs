import { randomUUID } from 'node:crypto';
import { createConnectorWorkerBroker } from '../connector-worker.mjs';

const DEFAULT_LIMITS = Object.freeze({ wallMs: 10_000, maxOutputBytes: 1_000_000, tempStorageBytes: 10 * 1024 * 1024 });

export function createIsolatedCodeRuntime({ sandboxRunner, clock } = {}) {
  if (!sandboxRunner?.detect || !sandboxRunner?.execute) throw new TypeError('isolated_code_runtime_sandbox_runner_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('isolated_code_runtime_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const activeJobs = new Map();

  async function run({ manifest, connectorPackage, capability, input, signal, networkAllowed }) {
    const availability = await sandboxRunner.detect();
    if (!availability.available) throw new Error('connector_isolation_unavailable');

    const limits = { ...DEFAULT_LIMITS, ...(manifest.limits ?? {}) };
    const broker = createConnectorWorkerBroker({
      manifest: networkAllowed ? manifest : { ...manifest, networkAllowlist: [] },
      limits,
    });

    const jobId = randomUUID();
    activeJobs.set(jobId, Object.freeze({ jobId, startedAt: new Date(now()).toISOString() }));
    try {
      const job = { limits, capability, input, connectorPackage, signal };
      return await sandboxRunner.execute({ jobId, job, broker, workspace: { sourcePath: connectorPackage, outPath: `connectors/out/${jobId}`, bootstrapPath: 'connector-worker.mjs' } });
    } finally {
      activeJobs.delete(jobId);
    }
  }

  return Object.freeze({
    async simulate({ manifest, connectorPackage, capability, input, signal }) {
      return run({ manifest, connectorPackage, capability, input, signal, networkAllowed: false });
    },

    async invoke({ manifest, connectorPackage, capability, input, signal }) {
      return run({ manifest, connectorPackage, capability, input, signal, networkAllowed: true });
    },

    async terminate(jobId) {
      const job = activeJobs.get(jobId);
      if (!job) return Object.freeze({ terminated: false });
      activeJobs.delete(jobId);
      await sandboxRunner.terminate?.(jobId);
      return Object.freeze({ terminated: true });
    },
  });
}
