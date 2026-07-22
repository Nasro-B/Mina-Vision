import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutomationDefinitionStore } from '../src/automation/automation-definition-store.mjs';
import { createAutomationGrantStore } from '../src/automation/automation-grant-store.mjs';
import { createSimulationEngine } from '../src/automation/simulation-engine.mjs';
import { createAutomationPolicy } from '../src/automation/automation-policy.mjs';
import { applyAutomationMigrations, createAutomationLedger } from '../src/automation/automation-ledger.mjs';
import { createAutomationRunner } from '../src/automation/automation-runner.mjs';
import { createRecoveryService } from '../src/recovery/recovery-service.mjs';
import { createEvaluationEngine } from '../src/evaluation/evaluation-engine.mjs';
import { createFixtureStore } from '../src/evaluation/fixture-store.mjs';
import { createHealthMonitor } from '../src/health/health-monitor.mjs';
import { createAutomationController } from '../src/ui/pages/automation-controller.mjs';
import { createRecoveryController } from '../src/ui/pages/recovery-controller.mjs';
import { createEvaluationController } from '../src/ui/pages/evaluation-controller.mjs';
import { registerMinaIpc, CORE_CHANNELS } from '../src/ui/ipc/register-ipc.mjs';

function fakeRepo() {
  const rows = new Map();
  return {
    async put(id, record) { rows.set(id, record); },
    async get(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
  };
}

function fakeIpcMain() {
  const handlers = new Map();
  return { handle: vi.fn((channel, handler) => handlers.set(channel, handler)), handlers };
}

let db;
let directory;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-automation-ui-'));
  db = new Database(join(directory, 'automation.sqlite'));
  applyAutomationMigrations(db);
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

function buildWorld() {
  const clock = () => 1_700_000_000_000;
  const definitionStore = createAutomationDefinitionStore({ repository: fakeRepo(), clock });
  const grantStore = createAutomationGrantStore({ repository: fakeRepo(), clock });
  const domainRegistry = { simulate: vi.fn(async () => ({})), invoke: vi.fn(async () => ({ ok: true })) };
  const simulationEngine = createSimulationEngine({
    domainRegistry, budgetEstimator: () => ({ estimatedCostMicros: 1, estimatedDurationMs: 1 }),
    disclosureClassifier: () => [], clock,
  });
  const capabilityBroker = { authorize: vi.fn(async () => ({ decision: 'allow', reason: 'ok' })) };
  const budgetGuard = { snapshot: vi.fn(async () => ({ remainingMicros: 1_000_000 })) };
  const automationPolicy = createAutomationPolicy({ capabilityBroker, budgetGuard, clock });
  const ledger = createAutomationLedger({ db, clock });
  const runner = createAutomationRunner({ ledger, domainRegistry, actionVerifier: { verify: vi.fn(async () => ({ confirmed: true })) }, clock });
  const recoveryService = createRecoveryService({ automationLedger: ledger, automationRunner: runner, clock });
  const fixtureStore = createFixtureStore();
  const evaluationEngine = createEvaluationEngine({ fixtureStore, domainRegistry, modelRouter: { route: vi.fn() }, clock });
  const healthMonitor = createHealthMonitor({ probes: [{ id: 'p', resourceId: 'r', read: async () => 'ok' }], clock });

  return {
    automationController: createAutomationController({
      automationDefinitionStore: definitionStore, automationGrantStore: grantStore, simulationEngine,
      automationPolicy, automationLedger: ledger, healthMonitor,
    }),
    recoveryController: createRecoveryController({ recoveryService }),
    evaluationController: createEvaluationController({ evaluationEngine }),
    definitionStore, grantStore, ledger, runner, domainRegistry,
  };
}

describe('automation/recovery/evaluation controllers: constructor guards', () => {
  it('createAutomationController requires its dependencies', () => {
    expect(() => createAutomationController({})).toThrow('automation_controller_dependencies_required');
  });

  it('createRecoveryController requires its dependencies', () => {
    expect(() => createRecoveryController({})).toThrow('recovery_controller_dependencies_required');
  });

  it('createEvaluationController requires its dependencies', () => {
    expect(() => createEvaluationController({})).toThrow('evaluation_controller_dependencies_required');
  });
});

describe('IPC channel allowlist: named channels only, never a raw execute escape hatch', () => {
  it('registers the exact automation/recovery/evaluation/health channels named by the plan', () => {
    const { automationController, recoveryController, evaluationController } = buildWorld();
    const ipcMain = fakeIpcMain();
    const { channels } = registerMinaIpc({
      ipcMain,
      coreChannels: CORE_CHANNELS,
      controllers: { automation: automationController, recovery: recoveryController, evaluation: evaluationController },
    });

    expect(channels).toContain('mina:automation:simulate');
    expect(channels).toContain('mina:automation:evaluate');
    expect(channels).toContain('mina:automation:get-run');
    expect(channels).toContain('mina:recovery:list-cases');
    expect(channels).toContain('mina:recovery:reconcile');
    expect(channels).toContain('mina:evaluation:run-suite');
    expect(channels).toContain('mina:health:snapshot');
  });

  it('never registers a raw/unmediated execute channel for automation, recovery, or evaluation', () => {
    const { automationController, recoveryController, evaluationController } = buildWorld();
    const ipcMain = fakeIpcMain();
    const { channels } = registerMinaIpc({
      ipcMain,
      coreChannels: CORE_CHANNELS,
      controllers: { automation: automationController, recovery: recoveryController, evaluation: evaluationController },
    });

    expect(channels).not.toContain('mina:automation:execute-raw');
    expect(channels).not.toContain('mina:automation:run');
    expect(channels).not.toContain('mina:automation:invoke-raw');
    for (const channel of channels) {
      expect(channel).not.toMatch(/execute-raw|invoke-raw/u);
    }
  });

  it('rejects a duplicate channel name across domains (defense in depth for the allowlist itself)', () => {
    const ipcMain = fakeIpcMain();
    expect(() => registerMinaIpc({
      ipcMain,
      coreChannels: ['mina:automation:simulate', 'mina:automation:simulate'],
      controllers: {},
    })).toThrow('ipc_channel_duplicate:mina:automation:simulate');
  });
});

describe('automation-controller.getRun: renderer receives a redacted DTO only', () => {
  it('strips the raw receipt/evidence/action payload, keeping only status metadata', async () => {
    const { automationController, ledger } = buildWorld();
    await ledger.startRun({ runId: 'run-1', automationId: 'def-1', simulationId: 'sim-1', digest: 'a'.repeat(64) });
    await ledger.recordStep({
      runId: 'run-1', key: 'run-1:0:d', index: 0,
      action: { actionType: 'notify', capability: 'telegram:send_message', text: 'Salut Paul, secret perso ici' },
      receipt: { messageId: 'msg-123', chatId: '999999', payloadCiphertext: 'ABCDEF...' },
      evidence: { confirmed: true, rawBody: 'contenu personnel brut' },
      status: 'verified',
    });

    const dto = await automationController.getRun('run-1');
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain('payloadCiphertext');
    expect(serialized).not.toContain('Salut Paul');
    expect(serialized).not.toContain('contenu personnel brut');
    expect(serialized).not.toContain('chatId');
    expect(dto.steps[0]).toMatchObject({ status: 'verified', actionType: 'notify', capability: 'telegram:send_message' });
  });

  it('returns null for an unknown run rather than throwing', async () => {
    const { automationController } = buildWorld();
    expect(await automationController.getRun('missing')).toBeNull();
  });
});

describe('recovery-controller: also redacts the nested run', () => {
  it('listCases never exposes raw receipt content from the underlying run', async () => {
    const { recoveryController, ledger, runner } = buildWorld();
    await runner.run({
      runId: 'run-1',
      definition: { automationId: 'def-1', status: 'active', version: 1 },
      decision: { decision: 'allow', reasons: [] },
      simulation: {
        simulationId: 'sim-1', digest: 'a'.repeat(64),
        proposedActions: [{ actionType: 'notify', capability: 'telegram:send_message', text: 'texte personnel' }],
      },
    });
    const cases = await recoveryController.listCases();
    expect(JSON.stringify(cases)).not.toContain('texte personnel');
  });
});

describe('automation-controller: transitions and grant creation happen only through the controller (main process)', () => {
  it('createDefinition -> transitionDefinition -> createGrant -> simulate -> evaluate end to end with real Task 1-4 components', async () => {
    const { automationController } = buildWorld();
    const created = await automationController.createDefinition({
      name: 'Rappel arrosage', description: 'desc', status: 'draft',
      allowedActions: [{ actionType: 'notify', capability: 'telegram:send_message' }],
    });
    await automationController.transitionDefinition({ automationId: created.automationId, nextStatus: 'shadow' });
    await automationController.transitionDefinition({ automationId: created.automationId, nextStatus: 'supervised' });
    const active = await automationController.transitionDefinition({ automationId: created.automationId, nextStatus: 'active' });
    expect(active.status).toBe('active');

    const simulation = await automationController.simulate({
      automationId: created.automationId,
      trigger: { triggerId: 't-1', type: 'manual', occurredAt: '2026-07-16T10:00:00.000Z', payload: { actions: [{ actionType: 'notify', capability: 'telegram:send_message' }] } },
      context: { mode: 'shadow' },
    });
    expect(simulation.digest).toMatch(/^[a-f0-9]{64}$/u);

    const grant = await automationController.createGrant({
      automationId: created.automationId, digest: simulation.digest, expiresAt: '2027-01-01T00:00:00.000Z',
      resourceScope: ['telegram:send_message'], channelScope: ['telegram'], schedule: null,
      maxRiskLevel: 3, maxFrequencyPerWindow: 5, maxCostMicros: 1_000_000, maxDurationMs: 5000,
    });

    const decision = await automationController.evaluate({
      automationId: created.automationId, grantId: grant.grantId,
      trigger: { triggerId: 't-1', type: 'manual', occurredAt: '2026-07-16T10:00:00.000Z', payload: {} },
      simulation, context: { channel: 'telegram', riskLevel: 1, recentRunCount: 0 },
    });
    expect(decision.decision).toBe('allow');
  });

  it('listDefinitions reflects every created definition', async () => {
    const { automationController } = buildWorld();
    await automationController.createDefinition({ name: 'A', description: '', status: 'draft', allowedActions: [] });
    await automationController.createDefinition({ name: 'B', description: '', status: 'draft', allowedActions: [] });
    expect(await automationController.listDefinitions()).toHaveLength(2);
  });
});

describe('evaluation-controller: runSuite and compareRuns delegate to the real evaluation engine', () => {
  it('runs a suite and compares two runs', async () => {
    const fixtureStore = createFixtureStore();
    fixtureStore.addFixture('s1', { fixtureId: 'f1', prompt: 'p', expectedClaimSupported: true, expectedCitations: [] });
    const modelRouter = { route: vi.fn(async () => ({ text: '', action: null, claimSupported: true, citations: [], usage: { latencyMs: 1, tokens: 1, costMicros: 1 } })) };
    const evaluationEngine = createEvaluationEngine({ fixtureStore, domainRegistry: { invoke: vi.fn(), simulate: vi.fn() }, modelRouter, clock: () => 0 });
    const controller = createEvaluationController({ evaluationEngine });

    const a = await controller.runSuite({ suiteId: 's1', candidates: ['x'] });
    const b = await controller.runSuite({ suiteId: 's1', candidates: ['x'] });
    const comparison = await controller.compareRuns([a.runId, b.runId]);
    expect(comparison.delta.factualAccuracy).toBe(0);
  });
});
