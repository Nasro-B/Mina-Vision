import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAutomationMigrations, createAutomationLedger } from '../src/automation/automation-ledger.mjs';

let db;
let directory;
let ledger;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-automation-ledger-'));
  db = new Database(join(directory, 'automation.sqlite'));
  applyAutomationMigrations(db);
  ledger = createAutomationLedger({ db, clock: () => 1_700_000_000_000 });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

describe('applyAutomationMigrations', () => {
  it('is idempotent: applying twice on the same database does not throw', () => {
    expect(() => applyAutomationMigrations(db)).not.toThrow();
  });

  it('rejects a database handle missing exec/prepare/transaction', () => {
    expect(() => applyAutomationMigrations({})).toThrow('automation_database_required');
  });
});

describe('createAutomationLedger: startRun', () => {
  it('creates a new run with status running and the given metadata', async () => {
    const run = await ledger.startRun({ runId: 'run-1', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64) });
    expect(run).toEqual({
      runId: 'run-1', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64),
      status: 'running', startedAt: 1_700_000_000_000, finishedAt: null, reconciliationAttempts: 0, steps: [],
    });
  });

  it('is idempotent: starting the same runId twice returns the existing run unchanged', async () => {
    const first = await ledger.startRun({ runId: 'run-1', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64) });
    const second = await ledger.startRun({ runId: 'run-1', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64) });
    expect(second).toEqual(first);
  });
});

describe('createAutomationLedger: recordStep and getStepByKey', () => {
  it('returns null for an unknown step key', async () => {
    expect(await ledger.getStepByKey('missing')).toBeNull();
  });

  it('records a step (with its originating action) and retrieves it by key', async () => {
    await ledger.startRun({ runId: 'run-1', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64) });
    await ledger.recordStep({
      runId: 'run-1', key: 'run-1:0:digest', index: 0, action: { actionType: 'notify', capability: 'telegram:send_message' },
      receipt: { ok: true }, evidence: { confirmed: true }, status: 'verified',
    });
    const step = await ledger.getStepByKey('run-1:0:digest');
    expect(step).toEqual({
      key: 'run-1:0:digest', runId: 'run-1', index: 0, action: { actionType: 'notify', capability: 'telegram:send_message' },
      receipt: { ok: true }, evidence: { confirmed: true }, status: 'verified',
      recordedAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
    });
  });

  it('defaults action to null when not provided', async () => {
    await ledger.startRun({ runId: 'run-1', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64) });
    await ledger.recordStep({ runId: 'run-1', key: 'run-1:0:digest', index: 0, receipt: {}, evidence: {}, status: 'verified' });
    expect((await ledger.getStepByKey('run-1:0:digest')).action).toBeNull();
  });
});

describe('createAutomationLedger: updateStepEvidence (reconciliation, never re-invokes)', () => {
  it('updates evidence and status on an existing step without touching recordedAt', async () => {
    await ledger.startRun({ runId: 'run-1', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64) });
    await ledger.recordStep({ runId: 'run-1', key: 'k', index: 0, receipt: {}, evidence: { confirmed: false }, status: 'unknown' });
    const updated = await ledger.updateStepEvidence({ key: 'k', evidence: { confirmed: true }, status: 'verified' });
    expect(updated.status).toBe('verified');
    expect(updated.evidence).toEqual({ confirmed: true });
    expect(updated.recordedAt).toBe(1_700_000_000_000);
  });
});

describe('createAutomationLedger: finishRun and getRun', () => {
  it('returns null for an unknown runId', async () => {
    expect(await ledger.getRun('missing')).toBeNull();
  });

  it('finishRun sets the terminal status and finishedAt, reflected by getRun', async () => {
    await ledger.startRun({ runId: 'run-1', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64) });
    await ledger.finishRun({ runId: 'run-1', status: 'completed' });
    const run = await ledger.getRun('run-1');
    expect(run.status).toBe('completed');
    expect(run.finishedAt).toBe(1_700_000_000_000);
  });

  it('finishRun with status running (resume after reconciliation) leaves finishedAt null', async () => {
    await ledger.startRun({ runId: 'run-1', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64) });
    await ledger.finishRun({ runId: 'run-1', status: 'unknown' });
    const resumed = await ledger.finishRun({ runId: 'run-1', status: 'running' });
    expect(resumed.status).toBe('running');
    expect(resumed.finishedAt).toBeNull();
  });

  it('getRun includes steps ordered by index', async () => {
    await ledger.startRun({ runId: 'run-1', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64) });
    await ledger.recordStep({ runId: 'run-1', key: 'run-1:1:d', index: 1, receipt: {}, evidence: {}, status: 'verified' });
    await ledger.recordStep({ runId: 'run-1', key: 'run-1:0:d', index: 0, receipt: {}, evidence: {}, status: 'verified' });
    const run = await ledger.getRun('run-1');
    expect(run.steps.map((step) => step.index)).toEqual([0, 1]);
  });
});

describe('createAutomationLedger: recordReconciliationAttempt', () => {
  it('increments reconciliationAttempts each time it is called', async () => {
    await ledger.startRun({ runId: 'run-1', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64) });
    await ledger.recordReconciliationAttempt('run-1');
    const once = await ledger.getRun('run-1');
    expect(once.reconciliationAttempts).toBe(1);
    await ledger.recordReconciliationAttempt('run-1');
    const twice = await ledger.getRun('run-1');
    expect(twice.reconciliationAttempts).toBe(2);
  });
});

describe('createAutomationLedger: listRuns', () => {
  it('lists every run, most recently started first', async () => {
    await ledger.startRun({ runId: 'run-a', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64) });
    await ledger.startRun({ runId: 'run-b', automationId: 'def-2', simulationId: 'sim-2', digest: 'b'.repeat(64) });
    const runs = await ledger.listRuns();
    expect(runs.map((run) => run.runId).sort()).toEqual(['run-a', 'run-b']);
  });

  it('filters by status when requested', async () => {
    await ledger.startRun({ runId: 'run-a', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64) });
    await ledger.startRun({ runId: 'run-b', automationId: 'def-2', simulationId: 'sim-2', digest: 'b'.repeat(64) });
    await ledger.finishRun({ runId: 'run-b', status: 'completed' });
    const running = await ledger.listRuns({ status: 'running' });
    expect(running.map((run) => run.runId)).toEqual(['run-a']);
  });
});
