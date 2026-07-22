import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createConnectorVersionService } from '../src/connectors/connector-version-service.mjs';
import { createConnectorRevocationService } from '../src/connectors/connector-revocation-service.mjs';
import { createConnectorInstaller } from '../src/connectors/connector-installer.mjs';
import { createConnectorRegistry } from '../src/connectors/connector-registry.mjs';
import { createPublisherTrustStore } from '../src/connectors/publisher-trust-store.mjs';
import { createAutomationDefinitionStore } from '../src/automation/automation-definition-store.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PACKAGE_DIGEST = `sha256:${'a'.repeat(64)}`;

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

function fakeZipInspector(manifestObject) {
  return { inspect: vi.fn(async () => ({ valid: true, manifestText: JSON.stringify(manifestObject), packageDigest: manifestObject.digest })) };
}

function fakeFilesystem() {
  const files = new Map();
  return { readFile: vi.fn(async () => Buffer.from('zip-bytes')), writeFile: vi.fn(async (path, bytes) => files.set(path, bytes)) };
}

function buildHarness() {
  const trustRepository = fakeRepository();
  const trustStore = createPublisherTrustStore({ repository: trustRepository, clock: () => 1_700_000_000_000 });
  const dependencyScanner = { scan: vi.fn(async () => []) };
  const filesystem = fakeFilesystem();
  let nextManifest = manifest();
  const zipInspector = { inspect: vi.fn(async () => ({ valid: true, manifestText: JSON.stringify(nextManifest), packageDigest: nextManifest.digest })) };
  const installer = createConnectorInstaller({ trustStore, zipInspector, dependencyScanner, filesystem, clock: () => 1_700_000_000_000 });
  const registry = createConnectorRegistry({ clock: () => 1_700_000_000_000 });
  const versions = createConnectorVersionService({ installer, registry, trustStore, clock: () => 1_700_000_000_000 });
  const automationRepository = fakeAutomationRepository();
  const automations = createAutomationDefinitionStore({ repository: automationRepository, clock: () => 1_700_000_000_000 });
  const revocations = createConnectorRevocationService({ trustStore, registry, automationDefinitionStore: automations, clock: () => 1_700_000_000_000 });

  return {
    trustStore, installer, registry, versions, automations, revocations,
    setNextManifest: (m) => { nextManifest = m; },
    fakeRuntime: () => ({ health: vi.fn(), simulate: vi.fn(), invoke: vi.fn(), verify: vi.fn() }),
  };
}

describe('createConnectorVersionService: constructor guards', () => {
  it('requires an installer', () => {
    expect(() => createConnectorVersionService({})).toThrow('connector_version_service_installer_required');
  });
});

describe('createConnectorVersionService.stageUpdate: exact plan example (extra capability requires confirmation)', () => {
  it('requires local confirmation when the staged package adds a capability beyond the active version', async () => {
    const { trustStore, versions, setNextManifest } = buildHarness();
    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });

    setNextManifest(manifest());
    const first = await versions.stageUpdate('pkg-v1.zip');
    await versions.activateVersion('weather-plugin', { confirmed: first.requiresLocalConfirmation });

    setNextManifest(manifest({ version: '1.1.0', capabilities: ['weather.read', 'weather.forecast.extended'] }));
    const staged = await versions.stageUpdate('pkg-v1.1.zip');
    expect(staged.requiresLocalConfirmation).toBe(true);
    expect(staged.permissionDiff.addedCapabilities).toEqual(['weather.forecast.extended']);
  });

  it('does not require confirmation when the staged package changes nothing permission-relevant', async () => {
    const { trustStore, versions, setNextManifest } = buildHarness();
    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });

    setNextManifest(manifest());
    const first = await versions.stageUpdate('pkg-v1.zip');
    await versions.activateVersion('weather-plugin', { confirmed: first.requiresLocalConfirmation });

    setNextManifest(manifest({ version: '1.0.1' }));
    const staged = await versions.stageUpdate('pkg-v1.0.1.zip');
    expect(staged.requiresLocalConfirmation).toBe(false);
  });
});

describe('createConnectorVersionService.activateVersion: confirmation gate', () => {
  it('rejects activating a staged version that requires confirmation without it', async () => {
    const { trustStore, versions, setNextManifest } = buildHarness();
    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });
    setNextManifest(manifest());
    await versions.stageUpdate('pkg-v1.zip');
    await expect(versions.activateVersion('weather-plugin', {})).rejects.toThrow('connector_version_confirmation_required');
  });

  it('rejects activating for a connector with no staged version', async () => {
    const { versions } = buildHarness();
    await expect(versions.activateVersion('unknown', { confirmed: true })).rejects.toThrow('connector_not_installed');
  });

  it('keeps the current version active until the new one is actually activated', async () => {
    const { trustStore, versions, setNextManifest } = buildHarness();
    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });
    setNextManifest(manifest());
    const first = await versions.stageUpdate('pkg-v1.zip');
    await versions.activateVersion('weather-plugin', { confirmed: first.requiresLocalConfirmation });

    setNextManifest(manifest({ version: '2.0.0', capabilities: ['weather.read', 'weather.alerts'] }));
    await versions.stageUpdate('pkg-v2.zip');
    expect(versions.getActive('weather-plugin').version).toBe('1.0.0');
  });
});

describe('createConnectorVersionService.rollback: one atomic active-version pointer change', () => {
  it('reverts to the immediately-previous activated version', async () => {
    const { trustStore, versions, setNextManifest } = buildHarness();
    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });

    setNextManifest(manifest());
    const first = await versions.stageUpdate('pkg-v1.zip');
    await versions.activateVersion('weather-plugin', { confirmed: first.requiresLocalConfirmation });

    setNextManifest(manifest({ version: '1.1.0', capabilities: ['weather.read', 'weather.forecast.extended'] }));
    const second = await versions.stageUpdate('pkg-v1.1.zip');
    await versions.activateVersion('weather-plugin', { confirmed: second.requiresLocalConfirmation });
    expect(versions.getActive('weather-plugin').version).toBe('1.1.0');

    const rolledBack = await versions.rollback('weather-plugin');
    expect(rolledBack.version).toBe('1.0.0');
    expect(versions.getActive('weather-plugin').version).toBe('1.0.0');
  });

  it('rejects rollback when there is no previous version', async () => {
    const { trustStore, versions, setNextManifest } = buildHarness();
    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });
    setNextManifest(manifest());
    const first = await versions.stageUpdate('pkg-v1.zip');
    await versions.activateVersion('weather-plugin', { confirmed: first.requiresLocalConfirmation });
    await expect(versions.rollback('weather-plugin')).rejects.toThrow('connector_no_previous_version');
  });
});

describe('createConnectorRevocationService: exact plan example (revoking a publisher suspends dependent automations)', () => {
  it('suspends an active automation whose allowedActions depend on a capability from the revoked publisher, and blocks further version activity', async () => {
    const { trustStore, registry, versions, automations, revocations, setNextManifest, fakeRuntime } = buildHarness();
    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });

    setNextManifest(manifest());
    const staged = await versions.stageUpdate('pkg-v1.zip');
    await versions.activateVersion('weather-plugin', { confirmed: staged.requiresLocalConfirmation });
    registry.register({ connectorId: 'weather-plugin', manifest: staged.manifest, runtime: fakeRuntime() });

    const created = await automations.create({
      name: 'Alerte météo', description: 'Prévient en cas de pluie', status: 'draft',
      allowedActions: [{ actionType: 'notify', capability: 'weather.read' }],
    });
    await automations.transition(created.automationId, 'shadow');
    await automations.transition(created.automationId, 'supervised');
    const active = await automations.transition(created.automationId, 'active');

    const result = await revocations.revokePublisher('pub-1');
    expect(result.suspendedAutomationIds).toContain(active.automationId);
    const after = await automations.get(active.automationId);
    expect(after.status).toBe('suspended');

    expect(await trustStore.isApproved('pub-1')).toBe(false);
    setNextManifest(manifest({ version: '1.2.0' }));
    await expect(versions.stageUpdate('pkg-v1.2.zip')).rejects.toThrow('connector_publisher_not_approved');
  });

  it('leaves an automation whose capability does not match the revoked publisher untouched', async () => {
    const { trustStore, registry, versions, automations, revocations, setNextManifest, fakeRuntime } = buildHarness();
    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });
    setNextManifest(manifest());
    const staged = await versions.stageUpdate('pkg-v1.zip');
    await versions.activateVersion('weather-plugin', { confirmed: staged.requiresLocalConfirmation });
    registry.register({ connectorId: 'weather-plugin', manifest: staged.manifest, runtime: fakeRuntime() });

    const created = await automations.create({
      name: 'Autre automatisation', description: 'Ne dépend pas de weather-plugin', status: 'draft',
      allowedActions: [{ actionType: 'notify', capability: 'unrelated.capability' }],
    });
    await automations.transition(created.automationId, 'shadow');

    await revocations.revokePublisher('pub-1');
    const after = await automations.get(created.automationId);
    expect(after.status).toBe('shadow');
  });

  it('skips a draft automation (NEXT table forbids draft to suspended) without throwing', async () => {
    const { trustStore, registry, automations, revocations, fakeRuntime } = buildHarness();
    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });
    registry.register({ connectorId: 'weather-plugin', manifest: manifest(), runtime: fakeRuntime() });

    const created = await automations.create({
      name: 'Automatisation brouillon', description: 'Encore en brouillon', status: 'draft',
      allowedActions: [{ actionType: 'notify', capability: 'weather.read' }],
    });

    const result = await revocations.revokePublisher('pub-1');
    expect(result.suspendedAutomationIds).toEqual([]);
    const after = await automations.get(created.automationId);
    expect(after.status).toBe('draft');
  });

  it('rejects revoking an unknown publisher', async () => {
    const { revocations } = buildHarness();
    await expect(revocations.revokePublisher('ghost')).rejects.toThrow('publisher_not_found');
  });
});
