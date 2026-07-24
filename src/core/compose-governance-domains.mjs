import { createInvokableDomainRegistry } from '../automation/invokable-domain-registry.mjs';
import { createBudgetEstimator } from '../automation/budget-estimator.mjs';
import { createDisclosureClassifier } from '../automation/disclosure-classifier.mjs';
import { createReceiptVerifier } from '../automation/receipt-verifier.mjs';
import { createSimulationEngine } from '../automation/simulation-engine.mjs';
import { createAutomationRunner } from '../automation/automation-runner.mjs';
import { applyAutomationMigrations, createAutomationLedger } from '../automation/automation-ledger.mjs';
import { createAutomationDefinitionStore } from '../automation/automation-definition-store.mjs';
import { createAutomationGrantStore } from '../automation/automation-grant-store.mjs';
import { createAutomationPolicy } from '../automation/automation-policy.mjs';
import { createRecoveryService } from '../recovery/recovery-service.mjs';
import { createFixtureStore } from '../evaluation/fixture-store.mjs';
import { createEvaluationEngine } from '../evaluation/evaluation-engine.mjs';
import { createEvaluationModelRouter } from '../evaluation/model-router.mjs';
import { createNetworkPolicy } from '../emergency/network-policy.mjs';
import { createDeviceGuard } from '../emergency/device-guard.mjs';
import { createEmergencyMode } from '../emergency/emergency-mode.mjs';
import { createEmergencyCorpus } from '../emergency/emergency-corpus.mjs';
import { createStateObserver } from '../approvals/state-observer.mjs';
import { createApprovalVerifier } from '../approvals/approval-verifier.mjs';
import { createRemoteApprovalService } from '../approvals/remote-approval-service.mjs';
import { createZipInspector } from '../connectors/zip-inspector.mjs';
import { createDependencyScanner } from '../connectors/dependency-scanner.mjs';
import { createConnectorInstaller } from '../connectors/connector-installer.mjs';
import { createPublisherTrustStore } from '../connectors/publisher-trust-store.mjs';

// Composition des domaines de GOUVERNANCE V4 (Tasks 10/12/13 de la réconciliation) : automation,
// recovery, evaluation, emergency, approvals, connectors — avec les VRAIS fournisseurs
// (registre invocable, estimateur, classificateur, politique réseau, garde périphériques,
// observateur d'état, inspecteur zip, scanner de dépendances). Chaque domaine sort avec un état
// honnête : `available` seulement quand toutes ses dépendances réelles sont là, sinon la raison
// exacte. Aucun simulacre : une dépendance absente rend le domaine absent, pas un faux vivant.

export function composeGovernanceDomains({
  clock = () => Date.now(),
  openAutomationDatabase = null, // () => better-sqlite3 Database (fichier automation.sqlite)
  automationRepositories = null, // { definitions: {put,get,list}, grants: {put,get,list} }
  capabilityBroker,
  budgetGuard,
  handlers = [], // [{prefix, handler}] — capabilities réelles branchées au registre invocable
  generate = null, // chaîne de génération réelle (évaluation) — null => domaine indisponible
  networkGates = [], // portes réseau réelles pour le mode urgence
  stopCamera = null,
  stopMicrophone = null,
  emergencyKeyring = null, // { open: async () => Buffer(32) } — clé du corpus urgence
  emergencyExporters = null, // [{sourceId, export()}] — sources réelles du corpus
  emergencyFilesystem = null, // { readFile, writeFile }
  connectorFilesystem = null, // { readFile, writeFile } — quarantaine des paquets
  connectorRepository = null, // { put, get, list } — éditeurs approuvés persistés
  ownerIdentity = null, // { isOwner } — identité Telegram du propriétaire
  logger = null,
} = {}) {
  if (!capabilityBroker?.authorize) throw new TypeError('governance_capability_broker_required');
  if (!budgetGuard?.snapshot) throw new TypeError('governance_budget_guard_required');

  const capabilities = [];
  const report = (domain, state, reason = null, instance = null) => {
    capabilities.push(Object.freeze({ domain, state, reason }));
    return instance;
  };

  // ── Registre invocable partagé (simulation, exécution, urgence, évaluation) ────────────────
  const registry = createInvokableDomainRegistry({ clock, logger });
  for (const { prefix, handler } of handlers) registry.register(prefix, handler);

  // ── Automation ──────────────────────────────────────────────────────────────────────────────
  let automation = null;
  if (typeof openAutomationDatabase === 'function') {
    try {
      const db = openAutomationDatabase();
      applyAutomationMigrations(db);
      const ledger = createAutomationLedger({ db, clock });
      const simulationEngine = createSimulationEngine({
        domainRegistry: registry,
        budgetEstimator: createBudgetEstimator(),
        disclosureClassifier: createDisclosureClassifier(),
        clock,
      });
      const runner = createAutomationRunner({
        ledger, domainRegistry: registry, actionVerifier: createReceiptVerifier(), clock,
      });
      // Stores (définitions/grants) et politique : composés si des repositories persistants sont
      // fournis — sinon le cœur simulate/run/ledger vit quand même, et l'absence est visible ici.
      const definitionStore = automationRepositories?.definitions
        ? createAutomationDefinitionStore({ repository: automationRepositories.definitions, clock })
        : null;
      const grantStore = automationRepositories?.grants
        ? createAutomationGrantStore({ repository: automationRepositories.grants, clock })
        : null;
      const policy = createAutomationPolicy({ capabilityBroker, budgetGuard, clock });
      automation = Object.freeze({
        definitionStore, grantStore, ledger, simulationEngine, runner, policy,
        close: () => { try { db.close(); } catch { /* best-effort */ } },
      });
      report('automation', 'available', null);
    } catch (error) {
      report('automation', 'unavailable', `automation_composition_echec:${String(error?.message ?? error).slice(0, 160)}`);
    }
  } else {
    report('automation', 'unavailable', 'base_automation_non_fournie');
  }

  // ── Recovery (dépend du runner d'automation) ────────────────────────────────────────────────
  let recovery = null;
  if (automation?.runner) {
    recovery = createRecoveryService({
      automationLedger: automation.ledger,
      automationRunner: automation.runner,
      domainReconcilers: {},
      clock,
    });
    report('recovery', 'available', null);
  } else {
    report('recovery', 'unavailable', 'dependance_absente:automation_runner');
  }

  // ── Evaluation (route vers la vraie chaîne de génération) ───────────────────────────────────
  let evaluation = null;
  if (typeof generate === 'function') {
    const fixtureStore = createFixtureStore();
    const modelRouter = createEvaluationModelRouter({ generate, clock });
    evaluation = Object.freeze({
      fixtureStore,
      modelRouter,
      engine: createEvaluationEngine({ fixtureStore, domainRegistry: registry, modelRouter, clock }),
    });
    report('evaluation', 'available', null);
  } else {
    report('evaluation', 'unavailable', 'generation_indisponible');
  }

  // ── Emergency (portes réseau réelles + garde périphériques + corpus scellé) ─────────────────
  const deviceGuard = createDeviceGuard({ stopCamera, stopMicrophone, logger });
  const networkPolicy = createNetworkPolicy({ gates: networkGates, logger });
  let emergency = null;
  let emergencyCorpus = null;
  if (emergencyKeyring && Array.isArray(emergencyExporters) && emergencyExporters.length > 0 && emergencyFilesystem) {
    try {
      emergencyCorpus = createEmergencyCorpus({
        keyring: emergencyKeyring, exporters: emergencyExporters, filesystem: emergencyFilesystem, clock,
      });
      emergency = createEmergencyMode({
        corpus: emergencyCorpus, networkPolicy, domainRegistry: registry, deviceGuard, clock,
      });
      report('emergency', 'available', null);
    } catch (error) {
      report('emergency', 'unavailable', `emergency_composition_echec:${String(error?.message ?? error).slice(0, 160)}`);
    }
  } else {
    report('emergency', 'degraded', 'corpus_non_configure_coupures_seules');
    // Même sans corpus, les coupures réseau/périphériques restent pilotables : un mode urgence
    // sans documentation hors-ligne vaut mieux que rien, et il le DIT.
  }

  // ── Approvals (observateur d'état réel, fail-closed) ────────────────────────────────────────
  const stateObserver = createStateObserver({ logger });
  const approvalVerifier = createApprovalVerifier({ stateObserver, capabilityBroker });
  let approvals = null;
  if (ownerIdentity?.isOwner) {
    approvals = createRemoteApprovalService({ ownerIdentity, approvalVerifier, clock });
    report('approvals', 'available', null);
  } else {
    report('approvals', 'degraded', 'identite_proprietaire_absente_verification_locale_seule');
  }

  // ── Connectors (inspection zip durcie + scan de dépendances + confiance éditeur) ────────────
  let connectors = null;
  if (connectorFilesystem && connectorRepository) {
    try {
      const trustStore = createPublisherTrustStore({ repository: connectorRepository, clock });
      connectors = Object.freeze({
        trustStore,
        installer: createConnectorInstaller({
          trustStore,
          zipInspector: createZipInspector(),
          dependencyScanner: createDependencyScanner(),
          filesystem: connectorFilesystem,
          clock,
        }),
      });
      report('connectors', 'available', null);
    } catch (error) {
      report('connectors', 'unavailable', `connectors_composition_echec:${String(error?.message ?? error).slice(0, 160)}`);
    }
  } else {
    report('connectors', 'unavailable', 'stockage_connecteurs_non_fourni');
  }

  return Object.freeze({
    registry,
    automation,
    recovery,
    evaluation,
    emergency,
    emergencyCorpus,
    deviceGuard,
    networkPolicy,
    stateObserver,
    approvalVerifier,
    approvals,
    connectors,
    capabilities: Object.freeze(capabilities),
    close: () => automation?.close?.(),
  });
}
