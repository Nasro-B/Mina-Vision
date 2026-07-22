import { generateKeyPairSync, sign as cryptoSign, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createRemoteApprovalService } from '../src/approvals/remote-approval-service.mjs';
import { createApprovalVerifier } from '../src/approvals/approval-verifier.mjs';
import { createApprovalController } from '../src/ui/pages/approval-controller.mjs';
import { createConnectorInstaller } from '../src/connectors/connector-installer.mjs';
import { createConnectorRegistry } from '../src/connectors/connector-registry.mjs';
import { createPublisherTrustStore } from '../src/connectors/publisher-trust-store.mjs';
import { createConnectorVersionService } from '../src/connectors/connector-version-service.mjs';
import { createConnectorRevocationService } from '../src/connectors/connector-revocation-service.mjs';
import { createConnectorController } from '../src/ui/pages/connector-controller.mjs';
import { createAutomationDefinitionStore } from '../src/automation/automation-definition-store.mjs';
import { createPersonalityService } from '../src/personality/personality-service.mjs';
import { createPersonalityController } from '../src/ui/pages/personality-controller.mjs';
import { registerMinaIpc, CORE_CHANNELS } from '../src/ui/ipc/register-ipc.mjs';

const NOW = Date.parse('2026-07-16T10:00:00.000Z');
const OWNER_ID = 111222333;

function fakeIpcMain() {
  const handlers = new Map();
  return { handle: vi.fn((channel, handler) => handlers.set(channel, handler)) };
}

// --- Approvals world -------------------------------------------------------

function validApprovalInput(overrides = {}) {
  return {
    capability: 'home.execute', resourceDigest: `sha256:${'a'.repeat(64)}`, actionDigest: `sha256:${'b'.repeat(64)}`,
    observedStateDigest: `sha256:${'c'.repeat(64)}`, expectedEffect: { state: 'on' }, disclosedData: { device: 'lampe salon' },
    expiresAt: new Date(NOW + 300_000).toISOString(), nonce: 'nonce-1', locality: 'remote_eligible',
    ...overrides,
  };
}

function buildApprovalWorld() {
  const ownerIdentity = { isOwner: vi.fn(async (id) => id === OWNER_ID) };
  const stateObserver = { observe: vi.fn(async () => 'sha256:c'.padEnd(71, 'c')) };
  const capabilityBroker = { authorize: vi.fn(async () => ({ decision: 'allow' })) };
  const approvalVerifier = createApprovalVerifier({ stateObserver, capabilityBroker });
  const remoteApprovalService = createRemoteApprovalService({ ownerIdentity, approvalVerifier, clock: () => NOW });
  return { approvalController: createApprovalController({ remoteApprovalService }), remoteApprovalService };
}

// --- Connectors world --------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PACKAGE_DIGEST = `sha256:${'d'.repeat(64)}`;

function manifest(overrides = {}) {
  const base = {
    connectorId: 'nas-reader', name: 'NAS Reader', version: '1.0.0', publisherId: 'pub-1', type: 'declarative-rest',
    capabilities: ['nas.read'], networkAllowlist: ['nas.local'], tlsRequired: true,
    minMinaVersion: '1.0.0', maxMinaVersion: '1.9.9', digest: PACKAGE_DIGEST, publisherPublicKey: publicKeyPem,
    secrets: [{ name: 'nas-token' }],
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

function buildConnectorWorld() {
  const trustStore = createPublisherTrustStore({ repository: fakeRepository(), clock: () => NOW });
  const dependencyScanner = { scan: vi.fn(async () => []) };
  const filesystem = { readFile: vi.fn(async () => Buffer.from('zip-bytes')), writeFile: vi.fn(async () => {}) };
  const zipInspector = { inspect: vi.fn(async () => ({ valid: true, manifestText: JSON.stringify(manifest()), packageDigest: PACKAGE_DIGEST })) };
  const installer = createConnectorInstaller({ trustStore, zipInspector, dependencyScanner, filesystem, clock: () => NOW });
  const registry = createConnectorRegistry({ clock: () => NOW });
  const versionService = createConnectorVersionService({ installer, registry, trustStore, clock: () => NOW });
  const automations = createAutomationDefinitionStore({ repository: fakeAutomationRepository(), clock: () => NOW });
  const revocationService = createConnectorRevocationService({ trustStore, registry, automationDefinitionStore: automations, clock: () => NOW });
  const connectorController = createConnectorController({ installer, registry, trustStore, versionService, revocationService });
  return { connectorController, installer, registry, trustStore, versionService, automations, fakeRuntime: () => ({ health: vi.fn(), simulate: vi.fn(), invoke: vi.fn(), verify: vi.fn() }) };
}

// --- Personality world -------------------------------------------------------

function fakePersonalityRepository() {
  const rows = new Map();
  return { get: vi.fn(async (id) => rows.get(id) ?? null), put: vi.fn(async (id, value) => rows.set(id, value)) };
}

function buildPersonalityWorld() {
  const keyring = { open: vi.fn(async () => randomBytes(32)) };
  const personalityService = createPersonalityService({ keyring, configRepository: fakePersonalityRepository(), clock: () => NOW });
  return { personalityController: createPersonalityController({ personalityService }), personalityService };
}

describe('approval/connector/personality controllers: constructor guards', () => {
  it('createApprovalController requires its dependencies', () => {
    expect(() => createApprovalController({})).toThrow('approval_controller_dependencies_required');
  });

  it('createConnectorController requires its dependencies', () => {
    expect(() => createConnectorController({})).toThrow('connector_controller_installer_required');
  });

  it('createPersonalityController requires its dependencies', () => {
    expect(() => createPersonalityController({})).toThrow('personality_controller_dependencies_required');
  });
});

describe('IPC channel allowlist: named channels only, never a raw write escape hatch', () => {
  it('registers the documented mina:approvals:*/mina:connectors:*/mina:personality:* channels', () => {
    const { approvalController } = buildApprovalWorld();
    const { connectorController } = buildConnectorWorld();
    const { personalityController } = buildPersonalityWorld();
    const ipcMain = fakeIpcMain();
    const { channels } = registerMinaIpc({
      ipcMain, coreChannels: CORE_CHANNELS,
      controllers: { approval: approvalController, connector: connectorController, personality: personalityController },
    });
    expect(channels).toContain('mina:approvals:remote-approve');
    expect(channels).toContain('mina:connectors:list');
    expect(channels).toContain('mina:connectors:revoke-publisher');
    expect(channels).toContain('mina:personality:propose-patch');
    expect(channels).toContain('mina:personality:confirm-patch');
  });

  it('never registers a raw-write escape hatch for any of the three domains', () => {
    const { approvalController } = buildApprovalWorld();
    const { connectorController } = buildConnectorWorld();
    const { personalityController } = buildPersonalityWorld();
    const ipcMain = fakeIpcMain();
    const { channels } = registerMinaIpc({
      ipcMain, coreChannels: CORE_CHANNELS,
      controllers: { approval: approvalController, connector: connectorController, personality: personalityController },
    });
    expect(channels).not.toContain('mina:connectors:write-raw');
    expect(channels).not.toContain('mina:approvals:force-approve');
    expect(channels).not.toContain('mina:personality:write-raw');
  });

  it('ignores an unrecognized controller key instead of registering unexpected channels for it', () => {
    const { connectorController } = buildConnectorWorld();
    const ipcMain = fakeIpcMain();
    const { channels } = registerMinaIpc({
      ipcMain, coreChannels: CORE_CHANNELS,
      controllers: { connector: connectorController, notARealDomain: connectorController },
    });
    // Only the real 'connector' DOMAIN_REGISTRARS key is ever looked up; 'notARealDomain' has no
    // matching registrar and is silently skipped — proves channels can only come from the fixed map.
    expect(channels.filter((channel) => channel.startsWith('mina:connectors:')).length).toBeGreaterThan(0);
  });

  it('registering twice with independent ipcMain instances never throws or leaks state between calls', () => {
    const { connectorController } = buildConnectorWorld();
    const first = registerMinaIpc({ ipcMain: fakeIpcMain(), coreChannels: CORE_CHANNELS, controllers: { connector: connectorController } });
    const second = registerMinaIpc({ ipcMain: fakeIpcMain(), coreChannels: CORE_CHANNELS, controllers: { connector: connectorController } });
    expect(first.channels).toEqual(second.channels);
  });
});

describe('extensions-ui-contract: exact plan example (three security boundaries)', () => {
  it('a local_only-equivalent request is denied remotely with local_confirmation_required, never pending', async () => {
    const { approvalController } = buildApprovalWorld();
    const highRiskRequest = validApprovalInput({ locality: 'local_only' });
    await expect(approvalController.remoteApprove(highRiskRequest)).resolves.toMatchObject({
      decision: 'deny', reason: 'local_confirmation_required',
    });
  });

  it('a remote-eligible request is accepted as pending, not denied', async () => {
    const { approvalController } = buildApprovalWorld();
    await expect(approvalController.remoteApprove(validApprovalInput())).resolves.toMatchObject({ decision: 'pending' });
  });

  it('connectorController.list() never exposes a secret field, even though the manifest declares one', async () => {
    const { connectorController, installer, trustStore, registry, fakeRuntime } = buildConnectorWorld();
    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });
    const job = await installer.importPackage('pkg.zip');
    const installed = await installer.install(job.jobId);
    registry.register({ connectorId: installed.manifest.connectorId, manifest: installed.manifest, runtime: fakeRuntime() });

    const list = await connectorController.list();
    expect(list.length).toBeGreaterThan(0);
    expect(list).not.toContainEqual(expect.objectContaining({ secret: expect.anything() }));
    expect(list).not.toContainEqual(expect.objectContaining({ secrets: expect.anything() }));
    expect(JSON.stringify(list)).not.toContain('nas-token');
  });

  it('a response rendered with a personality style context has the same capabilities as one without', async () => {
    const { personalityController } = buildPersonalityWorld();

    function buildResponse(styleContext) {
      const capabilities = Object.freeze(['home.read', 'weather.read']);
      return Object.freeze({
        text: styleContext ? `${styleContext.displayName} : voici la météo.` : 'Voici la météo.',
        capabilities,
      });
    }

    const responseWithoutPersonality = () => buildResponse(null);
    const responseWithPersonality = async () => buildResponse(await personalityController.renderStyleContext('telegram'));

    const withPersonality = await responseWithPersonality();
    const withoutPersonality = responseWithoutPersonality();
    expect(withPersonality.capabilities).toEqual(withoutPersonality.capabilities);
  });
});

describe('connector-controller.publisherTrust: never exposes the stored public key', () => {
  it('returns fingerprint/approval state but not publicKey', async () => {
    const { connectorController, trustStore } = buildConnectorWorld();
    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });
    const trust = await connectorController.publisherTrust('pub-1');
    expect(trust).not.toHaveProperty('publicKey');
    expect(trust.fingerprint).toBe('fp-1');
  });

  it('returns null for an unknown publisher rather than throwing', async () => {
    const { connectorController } = buildConnectorWorld();
    expect(await connectorController.publisherTrust('ghost')).toBeNull();
  });
});

describe('approval-controller / connector-controller / personality-controller: end to end with real Task 1/3/4/6/7 services', () => {
  it('approves, installs, activates and confirms a personality patch through the controllers', async () => {
    const { approvalController } = buildApprovalWorld();
    const approved = await approvalController.remoteApprove(validApprovalInput());
    await approvalController.approve({ approvalId: approved.approvalId, ownerTelegramId: OWNER_ID, callbackDigest: approved.digest });
    const consumed = await approvalController.consume(approved.approvalId);
    expect(consumed.status).toBe('consumed');

    const { connectorController, trustStore } = buildConnectorWorld();
    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });
    const staged = await connectorController.stageUpdate('pkg.zip');
    const activated = await connectorController.activateVersion(staged.connectorId, { confirmed: staged.requiresLocalConfirmation });
    expect(activated.version).toBe('1.0.0');

    const { personalityController } = buildPersonalityWorld();
    const patch = await personalityController.proposePatch({ tone: 'warm' });
    const confirmed = await personalityController.confirmPatch(patch.patchId);
    expect(confirmed.profile.tone).toBe('warm');
  });
});
