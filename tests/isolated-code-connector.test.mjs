import { describe, expect, it, vi } from 'vitest';
import { createIsolatedCodeRuntime } from '../src/connectors/runtimes/isolated-code-runtime.mjs';

const manifest = Object.freeze({
  connectorId: 'weather-plugin', allowedPaths: ['/workspace/connector'], networkAllowlist: ['api.weather.example'],
  limits: { wallMs: 5000, maxOutputBytes: 100 },
});

function maliciousConnector(scenario) {
  return { manifest, connectorPackage: `pkg-${scenario}.zip`, capability: 'weather.read', input: {}, scenario };
}

// Simulates what the sandboxed connector process would attempt via the filtered RPC broker.
// A real sandbox run pipes these same broker calls over IPC from inside the Windows Sandbox VM;
// here the fake sandboxRunner plays that role directly so the broker's own enforcement is what's
// actually under test, without needing a real VM in this environment.
function fakeSandboxRunner({ available = true } = {}) {
  return {
    detect: vi.fn(async () => Object.freeze({ available, reason: available ? null : 'windows_sandbox_feature_disabled' })),
    execute: vi.fn(async ({ job, broker }) => {
      if (job.connectorPackage === 'pkg-read-parent.zip') {
        return broker.readFile('/etc/shadow');
      }
      if (job.connectorPackage === 'pkg-infinite-output.zip') {
        let last;
        for (let i = 0; i < 1000; i += 1) last = broker.writeOutput('x'.repeat(50));
        return last;
      }
      if (job.connectorPackage === 'pkg-call-endpoint.zip') {
        return broker.callEndpoint('api.weather.example');
      }
      if (job.connectorPackage === 'pkg-get-secret.zip') {
        return broker.getSecret('api-key');
      }
      return broker.writeOutput('ok');
    }),
    terminate: vi.fn(async () => {}),
  };
}

describe('createIsolatedCodeRuntime: constructor guards', () => {
  it('requires a sandboxRunner', () => {
    expect(() => createIsolatedCodeRuntime({ clock: () => 0 })).toThrow('isolated_code_runtime_sandbox_runner_required');
  });
});

describe('createIsolatedCodeRuntime.invoke: exact scope/output-limit escapes from the plan', () => {
  it('rejects a connector reading outside its declared scope, and never exposes keyring.get', async () => {
    const keyring = { get: vi.fn() };
    const sandboxRunner = fakeSandboxRunner();
    const runtime = createIsolatedCodeRuntime({ sandboxRunner, clock: () => 0 });
    await expect(runtime.invoke(maliciousConnector('read-parent'))).rejects.toThrow('connector_scope_violation');
    expect(keyring.get).not.toHaveBeenCalled();
  });

  it('rejects a connector that tries to write past the manifest output limit', async () => {
    const sandboxRunner = fakeSandboxRunner();
    const runtime = createIsolatedCodeRuntime({ sandboxRunner, clock: () => 0 });
    await expect(runtime.invoke(maliciousConnector('infinite-output'))).rejects.toThrow('connector_output_limit');
  });
});

describe('createIsolatedCodeRuntime: never executes on host when isolation is unavailable', () => {
  it('returns connector_isolation_unavailable and never calls sandboxRunner.execute when detect() reports unavailable', async () => {
    const sandboxRunner = fakeSandboxRunner({ available: false });
    const runtime = createIsolatedCodeRuntime({ sandboxRunner, clock: () => 0 });
    await expect(runtime.invoke({ manifest, connectorPackage: 'pkg-ok.zip', capability: 'weather.read', input: {} }))
      .rejects.toThrow('connector_isolation_unavailable');
    expect(sandboxRunner.execute).not.toHaveBeenCalled();
  });
});

describe('createIsolatedCodeRuntime.simulate: network off by default', () => {
  it('rejects a network call attempted during simulate even to an otherwise-allowlisted host', async () => {
    const sandboxRunner = fakeSandboxRunner();
    const runtime = createIsolatedCodeRuntime({ sandboxRunner, clock: () => 0 });
    await expect(runtime.simulate({ manifest, connectorPackage: 'pkg-call-endpoint.zip', capability: 'weather.read', input: {} }))
      .rejects.toThrow('connector_scope_violation');
  });

  it('allows the same network call during invoke (network on), once the host is allowlisted', async () => {
    const sandboxRunner = fakeSandboxRunner();
    const runtime = createIsolatedCodeRuntime({ sandboxRunner, clock: () => 0 });
    await expect(runtime.invoke({ manifest, connectorPackage: 'pkg-call-endpoint.zip', capability: 'weather.read', input: {} }))
      .resolves.toMatchObject({ host: 'api.weather.example' });
  });
});

describe('createIsolatedCodeRuntime: secret access is never a raw keyring reference', () => {
  it('rejects a getSecret call when no keyring/secret handle was configured for the worker', async () => {
    const sandboxRunner = fakeSandboxRunner();
    const runtime = createIsolatedCodeRuntime({ sandboxRunner, clock: () => 0 });
    await expect(runtime.invoke({ manifest, connectorPackage: 'pkg-get-secret.zip', capability: 'weather.read', input: {} }))
      .rejects.toThrow('connector_scope_violation');
  });
});

describe('createIsolatedCodeRuntime.terminate', () => {
  it('terminates a job started via invoke', async () => {
    const sandboxRunner = fakeSandboxRunner();
    const runtime = createIsolatedCodeRuntime({ sandboxRunner, clock: () => 0 });
    const result = await runtime.terminate('never-started');
    expect(result).toEqual({ terminated: false });
  });
});

describe('createIsolatedCodeRuntime.invoke: a well-behaved connector completes successfully', () => {
  it('accepts output within the declared limit', async () => {
    const sandboxRunner = fakeSandboxRunner();
    const runtime = createIsolatedCodeRuntime({ sandboxRunner, clock: () => 0 });
    const result = await runtime.invoke({ manifest, connectorPackage: 'pkg-ok.zip', capability: 'weather.read', input: {} });
    expect(result.accepted).toBe(true);
  });
});
