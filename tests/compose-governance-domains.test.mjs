import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { composeGovernanceDomains } from '../src/core/compose-governance-domains.mjs';

const clock = () => 1_784_800_000_000;
const broker = { authorize: async () => ({ decision: 'allow', reason: 'test' }) };
const budgetGuard = { snapshot: async () => ({ remaining: 1_000_000 }) };

function memoryRepository() {
  const rows = new Map();
  return {
    async put(id, record) { rows.set(id, record); },
    async get(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
  };
}

const cleanups = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()(); });

async function fullCompose(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mina-governance-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const files = new Map();
  const filesystem = {
    readFile: async (path) => { const value = files.get(path); if (value == null) throw new Error('introuvable'); return value; },
    writeFile: async (path, bytes) => { files.set(path, bytes); },
  };
  const composed = composeGovernanceDomains({
    clock,
    openAutomationDatabase: () => new Database(join(directory, 'automation.sqlite')),
    automationRepositories: { definitions: memoryRepository(), grants: memoryRepository() },
    capabilityBroker: broker,
    budgetGuard,
    handlers: [{
      prefix: 'notify',
      handler: {
        simulate: async () => ({ effect: { delivered: true } }),
        invoke: async () => ({ effect: { delivered: true } }),
      },
    }],
    generate: async () => '{"claimSupported": false, "citations": [], "action": "none"}',
    networkGates: [{ id: 'test', disable: async () => {}, restore: async () => {} }],
    emergencyKeyring: { open: async () => Buffer.alloc(32, 7) },
    emergencyExporters: [{ sourceId: 'journal', export: async () => [{ itemId: 'j1', classification: 'normal', payload: 'entrée' }] }],
    emergencyFilesystem: filesystem,
    connectorFilesystem: filesystem,
    connectorRepository: memoryRepository(),
    ownerIdentity: { isOwner: (sender) => sender === 'nasro' },
    ...overrides,
  });
  cleanups.push(() => composed.close());
  return composed;
}

describe('composeGovernanceDomains — composition complète', () => {
  it('tous les domaines sortent available quand toutes les dépendances réelles sont là', async () => {
    const composed = await fullCompose();
    const state = Object.fromEntries(composed.capabilities.map((entry) => [entry.domain, entry.state]));
    expect(state).toEqual({
      automation: 'available',
      recovery: 'available',
      evaluation: 'available',
      emergency: 'available',
      approvals: 'available',
      connectors: 'available',
    });
    expect(composed.automation.simulationEngine).toBeTruthy();
    expect(composed.automation.definitionStore).toBeTruthy();
    expect(composed.automation.grantStore).toBeTruthy();
    expect(composed.automation.policy).toBeTruthy();
    expect(composed.recovery.listCases ?? composed.recovery).toBeTruthy();
    expect(composed.evaluation.engine).toBeTruthy();
    expect(composed.connectors.installer).toBeTruthy();
  });

  it('simulation puis exécution bout-en-bout à travers la composition', async () => {
    const composed = await fullCompose();
    const definition = { automationId: 'auto-x', version: 1, allowedActions: [{ actionType: 'notifier', capability: 'notify:pc' }] };
    const simulation = await composed.automation.simulationEngine.simulate({
      definition,
      trigger: { triggerId: 't', payload: { actions: [{ actionType: 'notifier', capability: 'notify:pc', expectedEffect: { delivered: true } }] } },
      context: {},
    });
    const run = await composed.automation.runner.run({
      runId: 'run-e2e', definition, simulation, decision: { decision: 'allow' },
    });
    expect(run.status).toBe('completed');
  });

  it('urgence bout-en-bout : construit le corpus, active, cherche, désactive', async () => {
    const composed = await fullCompose();
    const bundle = await composed.emergencyCorpus.build([{ sourceId: 'journal', itemIds: ['j1'] }], { destination: 'emergency/bundle.bin' });
    expect(bundle.bundleId).toBeTruthy();
    const activated = await composed.emergency.activate('emergency/bundle.bin');
    expect(activated.active).toBe(true);
    expect(composed.registry.isExternalDisabled()).toBe(true);
    await composed.emergency.deactivate();
    expect(composed.registry.isExternalDisabled()).toBe(false);
  });
});

describe('composeGovernanceDomains — dégradations honnêtes', () => {
  it('sans base automation : automation ET recovery indisponibles avec la raison exacte', async () => {
    const composed = await fullCompose({ openAutomationDatabase: null });
    const byDomain = Object.fromEntries(composed.capabilities.map((entry) => [entry.domain, entry]));
    expect(byDomain.automation.state).toBe('unavailable');
    expect(byDomain.automation.reason).toBe('base_automation_non_fournie');
    expect(byDomain.recovery.reason).toBe('dependance_absente:automation_runner');
  });

  it('sans génération : évaluation indisponible, le reste vit', async () => {
    const composed = await fullCompose({ generate: null });
    const byDomain = Object.fromEntries(composed.capabilities.map((entry) => [entry.domain, entry]));
    expect(byDomain.evaluation.state).toBe('unavailable');
    expect(byDomain.automation.state).toBe('available');
  });

  it('sans corpus urgence : emergency degraded (coupures seules), pas un faux available', async () => {
    const composed = await fullCompose({ emergencyKeyring: null });
    const byDomain = Object.fromEntries(composed.capabilities.map((entry) => [entry.domain, entry]));
    expect(byDomain.emergency.state).toBe('degraded');
    expect(byDomain.emergency.reason).toBe('corpus_non_configure_coupures_seules');
    // Les coupures restent réelles même sans corpus.
    await composed.networkPolicy.disableAll();
    expect(composed.networkPolicy.isDisabled()).toBe(true);
  });

  it('sans identité propriétaire : approvals degraded, vérification locale seule', async () => {
    const composed = await fullCompose({ ownerIdentity: null });
    const byDomain = Object.fromEntries(composed.capabilities.map((entry) => [entry.domain, entry]));
    expect(byDomain.approvals.state).toBe('degraded');
    expect(composed.approvalVerifier).toBeTruthy(); // le vérificateur local existe toujours
  });

  it('broker ou budget manquant : refus net à la composition', async () => {
    expect(() => composeGovernanceDomains({ capabilityBroker: null, budgetGuard })).toThrow('governance_capability_broker_required');
    expect(() => composeGovernanceDomains({ capabilityBroker: broker, budgetGuard: null })).toThrow('governance_budget_guard_required');
  });
});
