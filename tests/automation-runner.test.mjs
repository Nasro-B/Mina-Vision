import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAutomationMigrations, createAutomationLedger } from '../src/automation/automation-ledger.mjs';
import { createAutomationRunner } from '../src/automation/automation-runner.mjs';

let db;
let directory;
let ledger;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-automation-runner-'));
  db = new Database(join(directory, 'automation.sqlite'));
  applyAutomationMigrations(db);
  ledger = createAutomationLedger({ db, clock: () => 1_700_000_000_000 });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

const definition = Object.freeze({ automationId: 'def-1', status: 'active', version: 1 });
const allowDecision = Object.freeze({ decision: 'allow', reasons: [] });

function simulationWith(actions) {
  return Object.freeze({ simulationId: 'sim-1', digest: 'a'.repeat(64), proposedActions: actions });
}

function confirmedVerifier() {
  return { verify: vi.fn(async () => ({ confirmed: true })) };
}

describe('createAutomationRunner.run: safety gate on the policy decision', () => {
  it('refuses to run unless decision.decision is allow', async () => {
    const domainRegistry = { invoke: vi.fn() };
    const runner = createAutomationRunner({ ledger, domainRegistry, actionVerifier: confirmedVerifier(), clock: () => 0 });
    const simulation = simulationWith([{ actionType: 'notify', capability: 'telegram:send_message' }]);
    await expect(runner.run({
      runId: 'run-1', definition, simulation, decision: { decision: 'confirm', reasons: [] },
    })).rejects.toThrow('automation_run_requires_allow_decision');
    expect(domainRegistry.invoke).not.toHaveBeenCalled();
  });
});

describe('createAutomationRunner.run: happy path', () => {
  it('invokes each proposed action once with a deterministic idempotencyKey and finishes completed', async () => {
    const domainRegistry = { invoke: vi.fn(async () => ({ ok: true })) };
    const actionVerifier = confirmedVerifier();
    const runner = createAutomationRunner({ ledger, domainRegistry, actionVerifier, clock: () => 0 });
    const action = { actionType: 'notify', capability: 'telegram:send_message' };
    const simulation = simulationWith([action]);

    const result = await runner.run({ runId: 'run-1', definition, simulation, decision: allowDecision });

    expect(domainRegistry.invoke).toHaveBeenCalledTimes(1);
    expect(domainRegistry.invoke).toHaveBeenCalledWith({ ...action, idempotencyKey: 'run-1:0:' + simulation.digest, signal: expect.anything() });
    expect(actionVerifier.verify).toHaveBeenCalledWith({ action, receipt: { ok: true }, expectedEffect: undefined });
    expect(result.status).toBe('completed');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].status).toBe('verified');
  });

  it('is fully idempotent once completed: a second run call never invokes the domain again', async () => {
    const domainRegistry = { invoke: vi.fn(async () => ({ ok: true })) };
    const runner = createAutomationRunner({ ledger, domainRegistry, actionVerifier: confirmedVerifier(), clock: () => 0 });
    const simulation = simulationWith([{ actionType: 'notify', capability: 'telegram:send_message' }]);
    const runInput = { runId: 'run-1', definition, simulation, decision: allowDecision };

    await runner.run(runInput);
    const second = await runner.run(runInput);

    expect(domainRegistry.invoke).toHaveBeenCalledTimes(1);
    expect(second.status).toBe('completed');
  });
});

describe('createAutomationRunner.run: unconfirmed evidence stops the run without retry', () => {
  it('reconciles an accepted unknown step before any retry', async () => {
    const domainRegistry = { invoke: vi.fn(async () => ({ ok: true })) };
    const actionVerifier = { verify: vi.fn(async () => ({ confirmed: false })) };
    const runner = createAutomationRunner({ ledger, domainRegistry, actionVerifier, clock: () => 0 });
    const simulation = simulationWith([{ actionType: 'notify', capability: 'telegram:send_message' }]);
    const runInput = { runId: 'run-1', definition, simulation, decision: allowDecision };

    await runner.run(runInput);
    const second = await runner.run(runInput);

    expect(domainRegistry.invoke).toHaveBeenCalledTimes(1);
    expect(second.status).toBe('unknown');
  });

  it('never attempts a second proposed action once the first is unconfirmed', async () => {
    const domainRegistry = { invoke: vi.fn(async () => ({ ok: true })) };
    const actionVerifier = { verify: vi.fn(async () => ({ confirmed: false })) };
    const runner = createAutomationRunner({ ledger, domainRegistry, actionVerifier, clock: () => 0 });
    const simulation = simulationWith([
      { actionType: 'notify', capability: 'telegram:send_message' },
      { actionType: 'notify', capability: 'telegram:send_message' },
    ]);
    const result = await runner.run({ runId: 'run-1', definition, simulation, decision: allowDecision });
    expect(domainRegistry.invoke).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('unknown');
    expect(result.steps).toHaveLength(1);
  });
});

describe('createAutomationRunner.reconcile: re-verifies without ever re-invoking the domain', () => {
  it('flips an unknown step to verified and the run back to running when reconciliation confirms it', async () => {
    const domainRegistry = { invoke: vi.fn(async () => ({ ok: true })) };
    const actionVerifier = { verify: vi.fn(async () => ({ confirmed: false })) };
    const runner = createAutomationRunner({ ledger, domainRegistry, actionVerifier, clock: () => 0 });
    const simulation = simulationWith([{ actionType: 'notify', capability: 'telegram:send_message' }]);
    await runner.run({ runId: 'run-1', definition, simulation, decision: allowDecision });

    actionVerifier.verify.mockResolvedValueOnce({ confirmed: true });
    const reconciled = await runner.reconcile('run-1');

    expect(domainRegistry.invoke).toHaveBeenCalledTimes(1);
    expect(reconciled.status).toBe('running');
    expect(reconciled.steps[0].status).toBe('verified');
  });

  it('leaves the run unknown when reconciliation still cannot confirm the step', async () => {
    const domainRegistry = { invoke: vi.fn(async () => ({ ok: true })) };
    const actionVerifier = { verify: vi.fn(async () => ({ confirmed: false })) };
    const runner = createAutomationRunner({ ledger, domainRegistry, actionVerifier, clock: () => 0 });
    const simulation = simulationWith([{ actionType: 'notify', capability: 'telegram:send_message' }]);
    await runner.run({ runId: 'run-1', definition, simulation, decision: allowDecision });

    const reconciled = await runner.reconcile('run-1');
    expect(reconciled.status).toBe('unknown');
    expect(reconciled.reconciliationAttempts).toBe(1);
  });

  it('resuming run() after a successful reconciliation proceeds to the next un-attempted action', async () => {
    const domainRegistry = { invoke: vi.fn(async () => ({ ok: true })) };
    const actionVerifier = { verify: vi.fn(async () => ({ confirmed: false })) };
    const runner = createAutomationRunner({ ledger, domainRegistry, actionVerifier, clock: () => 0 });
    const simulation = simulationWith([
      { actionType: 'notify', capability: 'telegram:send_message' },
      { actionType: 'notify', capability: 'telegram:send_message' },
    ]);
    const runInput = { runId: 'run-1', definition, simulation, decision: allowDecision };

    await runner.run(runInput);
    expect(domainRegistry.invoke).toHaveBeenCalledTimes(1);

    actionVerifier.verify.mockResolvedValue({ confirmed: true });
    await runner.reconcile('run-1');
    const result = await runner.run(runInput);

    expect(domainRegistry.invoke).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('completed');
    expect(result.steps).toHaveLength(2);
  });

  it('rejects reconciling an unknown runId', async () => {
    const runner = createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: confirmedVerifier(), clock: () => 0 });
    await expect(runner.reconcile('missing')).rejects.toThrow('automation_run_not_found');
  });
});

describe('createAutomationRunner.cancel', () => {
  it('stops an in-flight run before its next proposed action and marks it cancelled', async () => {
    let releaseFirstInvoke;
    const invokeBlocked = new Promise((resolve) => { releaseFirstInvoke = resolve; });
    let invokeStarted = false;
    const domainRegistry = {
      invoke: vi.fn(async () => {
        invokeStarted = true;
        await invokeBlocked;
        return { ok: true };
      }),
    };
    const runner = createAutomationRunner({ ledger, domainRegistry, actionVerifier: confirmedVerifier(), clock: () => 0 });
    const simulation = simulationWith([
      { actionType: 'notify', capability: 'telegram:send_message' },
      { actionType: 'notify', capability: 'telegram:send_message' },
    ]);
    const runPromise = runner.run({ runId: 'run-1', definition, simulation, decision: allowDecision });
    while (!invokeStarted) await Promise.resolve();
    await runner.cancel('run-1');
    releaseFirstInvoke();
    const result = await runPromise;

    expect(result.status).toBe('cancelled');
    expect(result.steps).toHaveLength(1);
    expect(domainRegistry.invoke).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the run is not active', async () => {
    const runner = createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: confirmedVerifier(), clock: () => 0 });
    await expect(runner.cancel('never-started')).resolves.toEqual({ cancelled: false });
  });
});
