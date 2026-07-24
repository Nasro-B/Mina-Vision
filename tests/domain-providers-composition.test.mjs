import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { createInvokableDomainRegistry } from '../src/automation/invokable-domain-registry.mjs';
import { createBudgetEstimator } from '../src/automation/budget-estimator.mjs';
import { createDisclosureClassifier } from '../src/automation/disclosure-classifier.mjs';
import { createReceiptVerifier } from '../src/automation/receipt-verifier.mjs';
import { createSimulationEngine } from '../src/automation/simulation-engine.mjs';
import { createAutomationRunner } from '../src/automation/automation-runner.mjs';
import { createEvaluationModelRouter } from '../src/evaluation/model-router.mjs';
import { createNetworkPolicy } from '../src/emergency/network-policy.mjs';
import { createDeviceGuard } from '../src/emergency/device-guard.mjs';
import { createEmergencyMode } from '../src/emergency/emergency-mode.mjs';
import { createStateObserver } from '../src/approvals/state-observer.mjs';
import { createApprovalVerifier } from '../src/approvals/approval-verifier.mjs';
import { createZipInspector } from '../src/connectors/zip-inspector.mjs';
import { createDependencyScanner } from '../src/connectors/dependency-scanner.mjs';

// Ces tests prouvent que les FOURNISSEURS nouvellement construits satisfont les moteurs RÉELS
// (simulation-engine, automation-runner, emergency-mode, approval-verifier) — pas des interfaces
// imaginées : chaque moteur est composé tel quel, comme dans main.mjs.

const clock = () => 1_784_800_000_000;

function registryWithNotify() {
  const registry = createInvokableDomainRegistry({ clock });
  const sent = [];
  registry.register('notify', {
    describe: 'notification locale',
    simulate: async (action) => ({ effect: { delivered: true, channel: action.capability } }),
    invoke: async (action) => { sent.push(action); return { effect: { delivered: true }, detail: action.payload?.message ?? null }; },
  });
  return { registry, sent };
}

describe('invokable-domain-registry', () => {
  it('simulate avoue une capability inconnue au lieu de deviner', async () => {
    const { registry } = registryWithNotify();
    const outcome = await registry.simulate({ capability: 'demolition:maison' });
    expect(outcome.uncertainty).toContain('capability_inconnue');
  });

  it('invoke refuse une capability inconnue (fail-loud)', async () => {
    const { registry } = registryWithNotify();
    await expect(registry.invoke({ capability: 'demolition:maison' })).rejects.toThrow('capability_inconnue');
  });

  it('le mode urgence coupe les handlers externes mais pas les locaux', async () => {
    const { registry } = registryWithNotify();
    registry.register('telegram', { external: true, invoke: async () => ({ effect: { sent: true } }) });
    await registry.disableExternal();
    await expect(registry.invoke({ capability: 'telegram:message' })).rejects.toThrow('capability_externe_coupee');
    const receipt = await registry.invoke({ capability: 'notify:pc' });
    expect(receipt.effect.delivered).toBe(true);
    await registry.restore();
    const restored = await registry.invoke({ capability: 'telegram:message' });
    expect(restored.effect.sent).toBe(true);
  });
});

describe('simulation-engine composé avec les vrais fournisseurs', () => {
  const definition = Object.freeze({
    automationId: 'auto-1',
    version: 1,
    allowedActions: [{ actionType: 'notifier', capability: 'notify:pc' }],
  });

  function engine() {
    const { registry } = registryWithNotify();
    return createSimulationEngine({
      domainRegistry: registry,
      budgetEstimator: createBudgetEstimator(),
      disclosureClassifier: createDisclosureClassifier(),
      clock,
    });
  }

  it('simule des actions autorisées : budget + divulgations réels', async () => {
    const result = await engine().simulate({
      definition,
      trigger: { triggerId: 't-1', payload: { actions: [{ actionType: 'notifier', capability: 'notify:pc', payload: { message: 'joindre nasro@example.com' } }] } },
      context: {},
    });
    expect(result.proposedActions).toHaveLength(1);
    expect(result.estimatedUsage.actionCount).toBe(1);
    expect(result.estimatedUsage.estimatedDurationMs).toBeGreaterThan(0);
    expect(result.disclosures[0].level).toBe('personal'); // email détecté dans le payload
    expect(result.uncertainties).toHaveLength(0);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('refuse une action hors allowlist de la définition', async () => {
    await expect(engine().simulate({
      definition,
      trigger: { triggerId: 't-2', payload: { actions: [{ actionType: 'effacer', capability: 'fs:delete' }] } },
      context: {},
    })).rejects.toThrow('automation_action_not_allowed');
  });
});

describe('automation-runner composé avec registre + vérificateur de reçus', () => {
  function ledgerInMemory() {
    const runs = new Map();
    const steps = new Map();
    return {
      async startRun({ runId, automationId, simulationId, digest }) {
        if (!runs.has(runId)) runs.set(runId, { runId, automationId, simulationId, digest, status: 'running', steps: [], reconciliationAttempts: 0 });
      },
      async getRun(runId) { return runs.get(runId) ?? null; },
      async recordStep(step) { steps.set(step.key, step); runs.get(step.runId).steps.push(step); },
      async getStepByKey(key) { return steps.get(key) ?? null; },
      async finishRun({ runId, status }) { const run = runs.get(runId); run.status = status; return Object.freeze({ ...run }); },
      async recordReconciliationAttempt(runId) { runs.get(runId).reconciliationAttempts += 1; },
      async updateStepEvidence({ key, evidence, status }) { const step = steps.get(key); step.evidence = evidence; step.status = status; },
    };
  }

  it('exécute, vérifie chaque reçu et termine completed', async () => {
    const { registry, sent } = registryWithNotify();
    const runner = createAutomationRunner({
      ledger: ledgerInMemory(),
      domainRegistry: registry,
      actionVerifier: createReceiptVerifier(),
      clock,
    });
    const run = await runner.run({
      runId: 'run-1',
      definition: { automationId: 'auto-1' },
      simulation: {
        simulationId: 'sim-1',
        digest: 'd'.repeat(64),
        proposedActions: [{ actionType: 'notifier', capability: 'notify:pc', payload: { message: 'bonjour' }, expectedEffect: { delivered: true } }],
      },
      decision: { decision: 'allow' },
    });
    expect(run.status).toBe('completed');
    expect(sent).toHaveLength(1);
  });

  it("un effet attendu non prouvé arrête la course en 'unknown' — jamais de promesse", async () => {
    const registry = createInvokableDomainRegistry({ clock });
    registry.register('notify', { invoke: async () => ({ effect: { delivered: false } }) });
    const runner = createAutomationRunner({
      ledger: ledgerInMemory(), domainRegistry: registry, actionVerifier: createReceiptVerifier(), clock,
    });
    const run = await runner.run({
      runId: 'run-2',
      definition: { automationId: 'auto-1' },
      simulation: {
        simulationId: 'sim-2', digest: 'e'.repeat(64),
        proposedActions: [{ actionType: 'notifier', capability: 'notify:pc', expectedEffect: { delivered: true } }],
      },
      decision: { decision: 'allow' },
    });
    expect(run.status).toBe('unknown');
  });
});

describe('model-router évaluation', () => {
  it('route vers la vraie génération et rend un verdict structuré + usage mesuré', async () => {
    const router = createEvaluationModelRouter({
      generate: async () => 'Voici : {"claimSupported": true, "citations": ["doc-1"], "action": "none"}',
      clock,
    });
    const response = await router.route({ candidate: 'defaut', fixture: { prompt: 'Le ciel est bleu ?' } });
    expect(response.claimSupported).toBe(true);
    expect(response.citations).toEqual(['doc-1']);
    expect(response.usage.tokens).toBeGreaterThan(0);
  });

  it('réponse sans JSON => erreur (le moteur suspend, rien n’est inventé)', async () => {
    const router = createEvaluationModelRouter({ generate: async () => 'je ne sais pas', clock });
    await expect(router.route({ candidate: 'c', fixture: { prompt: 'x' } })).rejects.toThrow('evaluation_reponse_sans_json');
  });
});

describe('emergency-mode composé avec network-policy + device-guard', () => {
  function corpus() {
    return {
      verify: async () => ({
        bundleId: 'bundle-1',
        manifest: [{ itemId: 'i1', classification: 'normal', observedAt: '2026-07-24T00:00:00Z' }],
        items: { i1: 'numéro urgence 15' },
      }),
    };
  }

  it('activate coupe réseau + domaines externes + périphériques ; deactivate rétablit', async () => {
    const events = [];
    const gate = { id: 'telegram', disable: async () => events.push('telegram_off'), restore: async () => events.push('telegram_on') };
    const { registry } = registryWithNotify();
    registry.register('web', { external: true, invoke: async () => ({}) });
    const guard = createDeviceGuard({ stopCamera: async () => events.push('camera_off') });

    const emergency = createEmergencyMode({
      corpus: corpus(),
      networkPolicy: createNetworkPolicy({ gates: [gate] }),
      domainRegistry: registry,
      deviceGuard: guard,
      clock,
    });

    const activated = await emergency.activate('bundle.bin');
    expect(activated.active).toBe(true);
    expect(events).toEqual(['telegram_off', 'camera_off']);
    expect(registry.isExternalDisabled()).toBe(true);
    expect(() => guard.assertAllowed()).toThrow('urgence_peripheriques_bloques');

    const found = await emergency.search('urgence');
    expect(found.results ?? found).toBeTruthy();

    await emergency.deactivate();
    expect(events).toContain('telegram_on');
    expect(registry.isExternalDisabled()).toBe(false);
    expect(() => guard.assertAllowed()).not.toThrow();
  });
});

describe('approval-verifier composé avec state-observer', () => {
  const broker = { authorize: async () => ({ decision: 'allow' }) };

  it("valide quand l'état observé n'a pas changé, refuse quand il change", async () => {
    const observer = createStateObserver();
    const resourceDigest = `sha256:${'a'.repeat(64)}`;
    let state = { montant: 20 };
    const observed = await observer.register(resourceDigest, () => state);

    const verifier = createApprovalVerifier({ stateObserver: observer, capabilityBroker: broker });
    const record = { resourceDigest, observedStateDigest: observed, capability: 'payments:send' };

    expect((await verifier.verify(record)).verified).toBe(true);
    state = { montant: 900 }; // l'état réel a bougé après l'approbation
    const changed = await verifier.verify(record);
    expect(changed.verified).toBe(false);
    expect(changed.reason).toBe('approval_state_changed');
  });

  it('ressource jamais enregistrée => fail-closed (jamais validé à l’aveugle)', async () => {
    const verifier = createApprovalVerifier({ stateObserver: createStateObserver(), capabilityBroker: broker });
    const result = await verifier.verify({
      resourceDigest: `sha256:${'b'.repeat(64)}`,
      observedStateDigest: `sha256:${'c'.repeat(64)}`,
      capability: 'x',
    });
    expect(result.verified).toBe(false);
  });
});

describe('zip-inspector + dependency-scanner', () => {
  function buildPackage({ withManifest = true, bomb = false } = {}) {
    const zip = new AdmZip();
    const content = Buffer.from('module.exports = 1;', 'utf8');
    zip.addFile('index.js', content);
    if (bomb) zip.addFile('bomb.bin', Buffer.alloc(0)); // ratio testé via en-tête menteur difficile ici — couvert par limites déclarées
    const hash = createHash('sha256');
    hash.update('index.js', 'utf8');
    hash.update(Buffer.from([0]));
    hash.update(content);
    if (bomb) { hash.update('bomb.bin', 'utf8'); hash.update(Buffer.from([0])); hash.update(Buffer.alloc(0)); }
    const digest = `sha256:${hash.digest('hex')}`;
    if (withManifest) zip.addFile('manifest.json', Buffer.from(JSON.stringify({ digest }), 'utf8'));
    return { bytes: zip.toBuffer(), digest };
  }

  it('inspecte un paquet valide : manifestText + packageDigest reproductible', async () => {
    const { bytes, digest } = buildPackage();
    const inspection = await createZipInspector().inspect(bytes);
    expect(inspection.valid).toBe(true);
    expect(inspection.packageDigest).toBe(digest);
    expect(JSON.parse(inspection.manifestText).digest).toBe(digest);
  });

  it('refuse manifest absent, zip invalide et traversée de chemin', async () => {
    const inspector = createZipInspector();
    expect((await inspector.inspect(buildPackage({ withManifest: false }).bytes)).reason).toBe('connector_manifest_absent');
    expect((await inspector.inspect(Buffer.from('pas un zip'))).reason).toBe('connector_package_zip_invalide');
    // adm-zip normalise `../` à l'écriture, mais un zip HOSTILE lu du disque peut en contenir —
    // la garde reste en place ; on la prouve via un chemin absolu de lecteur, que l'écriture garde.
    const evil = new AdmZip();
    evil.addFile('C:/evasion.js', Buffer.from('x'));
    evil.addFile('manifest.json', Buffer.from('{}'));
    expect((await inspector.inspect(evil.toBuffer())).reason).toBe('connector_package_chemin_interdit');
  });

  it('scanner : capability interdite bloquante, http en clair élevé, wildcard élevé', async () => {
    const findings = await createDependencyScanner().scan({
      capabilities: ['shell.raw', 'notify:pc'],
      networkAllowlist: ['http://api.example.com', '*.evil.com'],
      tlsRequired: false,
      secrets: [],
    });
    const by = (reason) => findings.find((f) => f.reason === reason);
    expect(by('capability_interdite').level).toBe('bloquant');
    expect(by('http_en_clair').level).toBe('eleve');
    expect(by('domaine_wildcard').level).toBe('eleve');
    expect(by('tls_non_exige').level).toBe('eleve');
  });
});
