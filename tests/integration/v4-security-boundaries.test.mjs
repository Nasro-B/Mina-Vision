import { generateKeyPairSync, sign as cryptoSign, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { gateResponse } from '../../src/grounding/response-gate.mjs';
import { createConnectorInstaller } from '../../src/connectors/connector-installer.mjs';
import { createConnectorRegistry } from '../../src/connectors/connector-registry.mjs';
import { createPublisherTrustStore } from '../../src/connectors/publisher-trust-store.mjs';
import { createConnectorVersionService } from '../../src/connectors/connector-version-service.mjs';
import { createConnectorRevocationService } from '../../src/connectors/connector-revocation-service.mjs';
import { createConnectorController } from '../../src/ui/pages/connector-controller.mjs';
import { createAutomationDefinitionStore } from '../../src/automation/automation-definition-store.mjs';
import { createPersonalityService } from '../../src/personality/personality-service.mjs';
import { createPersonalityController } from '../../src/ui/pages/personality-controller.mjs';
import { createRemoteApprovalService } from '../../src/approvals/remote-approval-service.mjs';
import { createTelegramApprovalAdapter } from '../../src/messaging/telegram-approval-adapter.mjs';

const NOW = Date.parse('2026-07-16T10:00:00.000Z');
const PERSONALITY_KEY = randomBytes(32);

function fakePersonalityKeyring() {
  return { open: vi.fn(async () => PERSONALITY_KEY) };
}

function fakePersonalityRepository() {
  const rows = new Map();
  return { get: vi.fn(async (id) => rows.get(id) ?? null), put: vi.fn(async (id, v) => rows.set(id, v)) };
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PACKAGE_DIGEST = `sha256:${'e'.repeat(64)}`;

function manifest(overrides = {}) {
  const base = {
    connectorId: 'weather-plugin', name: 'Weather Plugin', version: '1.0.0', publisherId: 'pub-1', type: 'declarative-rest',
    capabilities: ['weather.read'], networkAllowlist: ['api.weather.example'], tlsRequired: true,
    minMinaVersion: '1.0.0', maxMinaVersion: '1.9.9', digest: PACKAGE_DIGEST, publisherPublicKey: publicKeyPem, secrets: [],
  };
  const merged = { ...base, ...overrides };
  if (!('signature' in overrides)) {
    merged.signature = cryptoSign('sha256', Buffer.from(merged.digest, 'utf8'), privateKey).toString('base64');
  }
  return merged;
}

function fakeRepository() {
  const rows = new Map();
  return { put: vi.fn(async (id, r) => rows.set(id, r)), get: vi.fn(async (id) => rows.get(id) ?? null) };
}

function fakeAutomationRepository() {
  const rows = new Map();
  return {
    async put(id, record) { rows.set(id, record); },
    async get(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
  };
}

describe('v4 integration: revoking a publisher cascades through the real connector + automation stack', () => {
  it('blocks all further version activity and suspends every dependent automation, observed through the admin controller layer', async () => {
    const trustStore = createPublisherTrustStore({ repository: fakeRepository(), clock: () => NOW });
    const dependencyScanner = { scan: vi.fn(async () => []) };
    const filesystem = { readFile: vi.fn(async () => Buffer.from('zip-bytes')), writeFile: vi.fn(async () => {}) };
    let currentManifest = manifest();
    const zipInspector = { inspect: vi.fn(async () => ({ valid: true, manifestText: JSON.stringify(currentManifest), packageDigest: currentManifest.digest })) };
    const installer = createConnectorInstaller({ trustStore, zipInspector, dependencyScanner, filesystem, clock: () => NOW });
    const registry = createConnectorRegistry({ clock: () => NOW });
    const versionService = createConnectorVersionService({ installer, registry, trustStore, clock: () => NOW });
    const automations = createAutomationDefinitionStore({ repository: fakeAutomationRepository(), clock: () => NOW });
    const revocationService = createConnectorRevocationService({ trustStore, registry, automationDefinitionStore: automations, clock: () => NOW });
    const connectorController = createConnectorController({ installer, registry, trustStore, versionService, revocationService });

    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });
    const staged = await connectorController.stageUpdate('pkg.zip');
    await connectorController.activateVersion(staged.connectorId, { confirmed: staged.requiresLocalConfirmation });
    registry.register({
      connectorId: staged.connectorId, manifest: staged.manifest,
      runtime: { health: vi.fn(), simulate: vi.fn(), invoke: vi.fn(), verify: vi.fn() },
    });

    const automation = await automations.create({
      name: 'Alerte météo', description: 'Prévient en cas de pluie', status: 'draft',
      allowedActions: [{ actionType: 'notify', capability: 'weather.read' }],
    });
    await automations.transition(automation.automationId, 'shadow');
    await automations.transition(automation.automationId, 'supervised');
    const active = await automations.transition(automation.automationId, 'active');

    await connectorController.revokePublisher('pub-1');

    const trust = await connectorController.publisherTrust('pub-1');
    expect(trust.revoked).toBe(true);

    currentManifest = manifest({ version: '1.1.0' });
    await expect(connectorController.stageUpdate('pkg-v1.1.zip')).rejects.toThrow('connector_publisher_not_approved');

    const after = await automations.get(active.automationId);
    expect(after.status).toBe('suspended');

    const stillListed = await connectorController.list();
    expect(stillListed).toContainEqual(expect.objectContaining({ connectorId: 'weather-plugin' }));
  });
});

describe('v4 integration: personality styling never crosses into the ResponseGate decision boundary', () => {
  it('leaves a real gateResponse "allow" text byte-identical after personality composition, and never exposes capability-shaped fields', async () => {
    const personalityService = createPersonalityService({ keyring: fakePersonalityKeyring(), configRepository: fakePersonalityRepository(), clock: () => NOW });
    const personalityController = createPersonalityController({ personalityService });
    const patch = await personalityController.proposePatch({ tone: 'warm', displayName: 'Mina' });
    await personalityController.confirmPatch(patch.patchId);

    const draft = { segments: [{ kind: 'text', text: 'Il fait beau aujourd’hui.' }] };
    const gated = gateResponse({ draft, claims: [], citations: [] });
    expect(gated.decision).toBe('allow');

    const styleContext = await personalityController.renderStyleContext('telegram');
    // Test-only composition glue (no "final response renderer" module exists yet — see Task 7's
    // documented decoupling from response-gate.mjs): style is attached alongside the gate's own
    // output, never merged into or derived from it.
    const finalEnvelope = Object.freeze({ decision: gated.decision, text: gated.response.text, style: styleContext });

    expect(finalEnvelope.text).toBe(gated.response.text);
    expect(finalEnvelope).not.toHaveProperty('capabilities');
    expect(finalEnvelope.style).not.toHaveProperty('memoryPolicy');
  });

  it('leaves a real gateResponse "block" decision unrescued by personality — no text ever appears', async () => {
    const personalityService = createPersonalityService({ keyring: fakePersonalityKeyring(), configRepository: fakePersonalityRepository(), clock: () => NOW });
    const personalityController = createPersonalityController({ personalityService });

    const draft = { segments: [{ kind: 'factual', claimId: 'claim-1', text: 'Le solde est de 500€.' }] };
    const claims = [{ claimId: 'claim-1', claimType: 'security', status: 'unverified', evidenceIds: [] }];
    const gated = gateResponse({ draft, claims, citations: [] });
    expect(gated.decision).toBe('block');
    expect(gated).not.toHaveProperty('response');

    const styleContext = await personalityController.renderStyleContext('telegram');
    const finalEnvelope = Object.freeze({
      decision: gated.decision,
      text: gated.decision === 'allow' ? gated.response.text : gated.safeResponse,
      style: styleContext,
    });

    expect(finalEnvelope.decision).toBe('block');
    expect(finalEnvelope.text).toBe('Je ne peux pas confirmer cette information sensible avec les preuves disponibles.');
  });
});

describe('v4 integration: the Telegram remote channel is structurally incapable of driving connector activation or personality confirmation', () => {
  it('rejects a connector-controller-shaped object as an approval service (wrong shape: no approve/deny/get)', async () => {
    const trustStore = createPublisherTrustStore({ repository: fakeRepository(), clock: () => NOW });
    const installer = createConnectorInstaller({
      trustStore, zipInspector: { inspect: vi.fn(async () => ({ valid: true, manifestText: JSON.stringify(manifest()), packageDigest: PACKAGE_DIGEST })) },
      dependencyScanner: { scan: vi.fn(async () => []) },
      filesystem: { readFile: vi.fn(async () => Buffer.from('x')), writeFile: vi.fn(async () => {}) },
      clock: () => NOW,
    });
    const registry = createConnectorRegistry({ clock: () => NOW });
    const versionService = createConnectorVersionService({ installer, registry, trustStore, clock: () => NOW });
    const automations = createAutomationDefinitionStore({ repository: fakeAutomationRepository(), clock: () => NOW });
    const revocationService = createConnectorRevocationService({ trustStore, registry, automationDefinitionStore: automations, clock: () => NOW });
    const connectorController = createConnectorController({ installer, registry, trustStore, versionService, revocationService });

    expect(() => createTelegramApprovalAdapter({
      approvalService: connectorController, isOwner: vi.fn(), transport: { sendMessage: vi.fn() }, audit: { record: vi.fn() },
    })).toThrow('telegram_approval_adapter_service_required');
  });

  it('rejects a personality-controller-shaped object as an approval service (has get, but no approve/deny)', async () => {
    const personalityService = createPersonalityService({ keyring: fakePersonalityKeyring(), configRepository: fakePersonalityRepository(), clock: () => NOW });
    const personalityController = createPersonalityController({ personalityService });

    expect(() => createTelegramApprovalAdapter({
      approvalService: personalityController, isOwner: vi.fn(), transport: { sendMessage: vi.fn() }, audit: { record: vi.fn() },
    })).toThrow('telegram_approval_adapter_service_required');
  });

  it('accepts the real remote-approval-service (correct shape), proving the guard discriminates on shape, not on hardcoded module identity', () => {
    const remoteApprovalService = createRemoteApprovalService({
      ownerIdentity: { isOwner: vi.fn(async () => true) },
      approvalVerifier: { verify: vi.fn(async () => ({ verified: true, reason: null })) },
      clock: () => NOW,
    });
    expect(() => createTelegramApprovalAdapter({
      approvalService: remoteApprovalService, isOwner: vi.fn(async () => true), transport: { sendMessage: vi.fn() }, audit: { record: vi.fn() },
    })).not.toThrow();
  });
});
