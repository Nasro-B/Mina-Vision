import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAutomationMigrations, createAutomationLedger } from '../src/automation/automation-ledger.mjs';
import { createAutomationRunner } from '../src/automation/automation-runner.mjs';
import { createRecoveryService } from '../src/recovery/recovery-service.mjs';

let db;
let directory;
let ledger;

const definition = Object.freeze({ automationId: 'def-1', status: 'active', version: 1 });
const allowDecision = Object.freeze({ decision: 'allow', reasons: [] });

function simulationWith(actions, digest = 'a'.repeat(64)) {
  return Object.freeze({ simulationId: 'sim-1', digest, proposedActions: actions });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-recovery-service-'));
  db = new Database(join(directory, 'automation.sqlite'));
  applyAutomationMigrations(db);
  ledger = createAutomationLedger({ db, clock: () => 1_700_000_000_000 });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

async function makeVerifiedRun(runId = 'run-verified') {
  const runner = createAutomationRunner({
    ledger, domainRegistry: { invoke: vi.fn(async () => ({ ok: true })) },
    actionVerifier: { verify: vi.fn(async () => ({ confirmed: true })) }, clock: () => 0,
  });
  await runner.run({
    runId, definition, decision: allowDecision,
    simulation: simulationWith([{ actionType: 'notify', capability: 'telegram:send_message' }], `${runId}-digest`.padEnd(64, '0')),
  });
}

async function makeUnknownRun(runId = 'run-unknown') {
  const runner = createAutomationRunner({
    ledger, domainRegistry: { invoke: vi.fn(async () => ({ ok: true })) },
    actionVerifier: { verify: vi.fn(async () => ({ confirmed: false })) }, clock: () => 0,
  });
  await runner.run({
    runId, definition, decision: allowDecision,
    simulation: simulationWith([{ actionType: 'notify', capability: 'telegram:send_message' }], `${runId}-digest`.padEnd(64, '0')),
  });
  return runner;
}

describe('createRecoveryService: constructor guards', () => {
  it('requires an automationLedger', () => {
    expect(() => createRecoveryService({ automationRunner: {}, clock: () => 0 })).toThrow('recovery_service_ledger_required');
  });

  it('requires an automationRunner', () => {
    expect(() => createRecoveryService({ automationLedger: ledger, clock: () => 0 })).toThrow('recovery_service_runner_required');
  });
});

describe('createRecoveryService.listCases', () => {
  it('excludes in-progress (running) runs — they are not yet a recovery case', async () => {
    await ledger.startRun({ runId: 'run-mid', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64) });
    const service = createRecoveryService({ automationLedger: ledger, automationRunner: createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: { verify: vi.fn() }, clock: () => 0 }), clock: () => 0 });
    const cases = await service.listCases();
    expect(cases.find((c) => c.caseId === 'run-mid')).toBeUndefined();
  });

  it('projects a completed run as verified_complete with no allowed actions', async () => {
    await makeVerifiedRun();
    const service = createRecoveryService({ automationLedger: ledger, automationRunner: createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: { verify: vi.fn() }, clock: () => 0 }), clock: () => 0 });
    const cases = await service.listCases();
    const found = cases.find((c) => c.caseId === 'run-verified');
    expect(found).toMatchObject({ classification: 'verified_complete', allowedActions: [] });
  });

  it('projects a fresh unknown run as accepted_state_unknown before any reconciliation', async () => {
    await makeUnknownRun();
    const service = createRecoveryService({ automationLedger: ledger, automationRunner: createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: { verify: vi.fn() }, clock: () => 0 }), clock: () => 0 });
    const cases = await service.listCases();
    const found = cases.find((c) => c.caseId === 'run-unknown');
    expect(found).toMatchObject({ classification: 'accepted_state_unknown', allowedActions: ['reconcile', 'close_manually'] });
  });

  it('filters by classification when requested', async () => {
    await makeVerifiedRun('run-v');
    await makeUnknownRun('run-u');
    const service = createRecoveryService({ automationLedger: ledger, automationRunner: createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: { verify: vi.fn() }, clock: () => 0 }), clock: () => 0 });
    const cases = await service.listCases({ classification: 'accepted_state_unknown' });
    expect(cases.map((c) => c.caseId)).toEqual(['run-u']);
  });
});

describe('createRecoveryService.reconcile: delegates to the automation runner, tracks attempts', () => {
  it('reprojects the case after a reconciliation that still cannot confirm it', async () => {
    await makeUnknownRun('run-1');
    const runner = createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: { verify: vi.fn(async () => ({ confirmed: false })) }, clock: () => 0 });
    const domainReconcilers = { telegram: vi.fn() };
    const service = createRecoveryService({ automationLedger: ledger, automationRunner: runner, domainReconcilers, clock: () => 0 });

    const result = await service.reconcile('run-1');
    expect(result.classification).toBe('reconcilable');
    expect(result.allowedActions).toEqual(['reconcile', 'close_manually']);
  });

  it('reprojects as manual_action_required when no domain reconciler is registered', async () => {
    await makeUnknownRun('run-1');
    const runner = createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: { verify: vi.fn(async () => ({ confirmed: false })) }, clock: () => 0 });
    const service = createRecoveryService({ automationLedger: ledger, automationRunner: runner, domainReconcilers: {}, clock: () => 0 });

    const result = await service.reconcile('run-1');
    expect(result.classification).toBe('manual_action_required');
    expect(result.allowedActions).toEqual(['close_manually']);
  });

  it('reprojects as verified_complete once reconciliation confirms the effect', async () => {
    await makeUnknownRun('run-1');
    const actionVerifier = { verify: vi.fn(async () => ({ confirmed: true })) };
    const runner = createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier, clock: () => 0 });
    const service = createRecoveryService({ automationLedger: ledger, automationRunner: runner, clock: () => 0 });

    const result = await service.reconcile('run-1');
    expect(result.classification).toBe('verified_complete');
  });

  it('rejects reconciling an unknown caseId', async () => {
    const runner = createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: { verify: vi.fn() }, clock: () => 0 });
    const service = createRecoveryService({ automationLedger: ledger, automationRunner: runner, clock: () => 0 });
    await expect(service.reconcile('missing')).rejects.toThrow('automation_run_not_found');
  });
});

describe('createRecoveryService.proposeNextAction', () => {
  it('proposes the first allowed action for an unresolved case', async () => {
    await makeUnknownRun();
    const service = createRecoveryService({ automationLedger: ledger, automationRunner: createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: { verify: vi.fn() }, clock: () => 0 }), clock: () => 0 });
    expect(await service.proposeNextAction('run-unknown')).toBe('reconcile');
  });

  it('proposes null when the case has nothing left to do', async () => {
    await makeVerifiedRun();
    const service = createRecoveryService({ automationLedger: ledger, automationRunner: createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: { verify: vi.fn() }, clock: () => 0 }), clock: () => 0 });
    expect(await service.proposeNextAction('run-verified')).toBeNull();
  });
});

describe('createRecoveryService.closeManually', () => {
  it('records a note and excludes the case from listCases afterwards', async () => {
    await makeUnknownRun();
    const service = createRecoveryService({ automationLedger: ledger, automationRunner: createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: { verify: vi.fn() }, clock: () => 0 }), clock: () => 5000 });
    const closed = await service.closeManually('run-unknown', 'Vérifié manuellement avec Nasro, sans effet.');
    expect(closed).toMatchObject({ caseId: 'run-unknown', note: 'Vérifié manuellement avec Nasro, sans effet.', closedAt: 5000 });

    const cases = await service.listCases();
    expect(cases.find((c) => c.caseId === 'run-unknown')).toBeUndefined();
  });

  it('is included in listCases when includeClosed is requested', async () => {
    await makeUnknownRun();
    const service = createRecoveryService({ automationLedger: ledger, automationRunner: createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: { verify: vi.fn() }, clock: () => 0 }), clock: () => 0 });
    await service.closeManually('run-unknown', 'note');
    const cases = await service.listCases({ includeClosed: true });
    const found = cases.find((c) => c.caseId === 'run-unknown');
    expect(found.closedManually).toMatchObject({ note: 'note' });
  });

  it('rejects closing an unknown caseId', async () => {
    const service = createRecoveryService({ automationLedger: ledger, automationRunner: createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: { verify: vi.fn() }, clock: () => 0 }), clock: () => 0 });
    await expect(service.closeManually('missing', 'note')).rejects.toThrow('automation_run_not_found');
  });

  it('rejects an empty note', async () => {
    await makeUnknownRun();
    const service = createRecoveryService({ automationLedger: ledger, automationRunner: createAutomationRunner({ ledger, domainRegistry: { invoke: vi.fn() }, actionVerifier: { verify: vi.fn() }, clock: () => 0 }), clock: () => 0 });
    await expect(service.closeManually('run-unknown', '')).rejects.toThrow('recovery_close_note_required');
  });
});
