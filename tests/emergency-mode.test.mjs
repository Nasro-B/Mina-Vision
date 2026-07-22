import { describe, expect, it, vi } from 'vitest';
import { createEmergencyCorpus } from '../src/emergency/emergency-corpus.mjs';
import { createEmergencyMode } from '../src/emergency/emergency-mode.mjs';

function fakeKeyring() {
  return { open: vi.fn(async () => Buffer.alloc(32, 7)) };
}

function fakeFilesystem() {
  const files = new Map();
  return { files, writeFile: vi.fn(async (path, bytes) => files.set(path, bytes)), readFile: vi.fn(async (path) => files.get(path)) };
}

function contactExporter() {
  return {
    sourceId: 'contacts',
    export: vi.fn(async (itemIds) => itemIds.map((id) => ({ itemId: id, classification: 'sensitive', payload: 'Contact urgence: Dr Martin +33600000000' }))),
  };
}

function fakeNetworkPolicy() {
  let disabled = false;
  return {
    disabled: () => disabled,
    disableAll: vi.fn(async () => { disabled = true; }),
    restore: vi.fn(async () => { disabled = false; }),
  };
}

function fakeDomainRegistry() {
  return { disableExternal: vi.fn(async () => {}), restore: vi.fn(async () => {}) };
}

function fakeDeviceGuard() {
  return { disableCameraAndMic: vi.fn(async () => {}), restore: vi.fn(async () => {}) };
}

async function buildWorld() {
  const keyring = fakeKeyring();
  const filesystem = fakeFilesystem();
  const corpus = createEmergencyCorpus({ keyring, exporters: [contactExporter()], filesystem, clock: () => 1_700_000_000_000 });
  const networkPolicy = fakeNetworkPolicy();
  const domainRegistry = fakeDomainRegistry();
  const deviceGuard = fakeDeviceGuard();
  const mode = createEmergencyMode({ corpus, networkPolicy, domainRegistry, deviceGuard, clock: () => 1_700_000_000_000 });
  const bundle = await corpus.build([{ sourceId: 'contacts', itemIds: ['c1'] }]);
  return { corpus, mode, filesystem, networkPolicy, domainRegistry, deviceGuard, bundle };
}

describe('createEmergencyMode: constructor guards', () => {
  it('requires a corpus', () => {
    expect(() => createEmergencyMode({})).toThrow('emergency_mode_corpus_required');
  });
});

describe('createEmergencyMode: offline activation, search, tamper detection (plan example)', () => {
  it('activates offline, searches with observedAt, and rejects a tampered bundle', async () => {
    const { mode, filesystem, networkPolicy, bundle } = await buildWorld();

    await networkPolicy.disableAll();
    await mode.activate(bundle.path);
    const found = await mode.search('contact urgence');
    expect(found).toHaveProperty('observedAt');
    expect(found.results.length).toBeGreaterThan(0);

    const envelope = JSON.parse(filesystem.files.get(bundle.path).toString('utf8'));
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    ciphertext[0] ^= 0xff;
    envelope.ciphertext = ciphertext.toString('base64');
    filesystem.files.set(bundle.path, Buffer.from(JSON.stringify(envelope)));

    await expect(mode.activate(bundle.path)).rejects.toThrow('emergency_manifest_invalid');
  });
});

describe('createEmergencyMode.activate: disables cloud/external automations/network, camera/mic off', () => {
  it('disables network, external automations, and camera/mic on activation', async () => {
    const { mode, networkPolicy, domainRegistry, deviceGuard, bundle } = await buildWorld();
    await mode.activate(bundle.path);
    expect(networkPolicy.disableAll).toHaveBeenCalledTimes(1);
    expect(domainRegistry.disableExternal).toHaveBeenCalledTimes(1);
    expect(deviceGuard.disableCameraAndMic).toHaveBeenCalledTimes(1);
  });

  it('reports active status with the bundle id after activation', async () => {
    const { mode, bundle } = await buildWorld();
    await mode.activate(bundle.path);
    expect(mode.status()).toMatchObject({ active: true, bundleId: bundle.bundleId });
  });
});

describe('createEmergencyMode.deactivate', () => {
  it('restores network/domain/device state and clears active status', async () => {
    const { mode, networkPolicy, domainRegistry, deviceGuard, bundle } = await buildWorld();
    await mode.activate(bundle.path);
    await mode.deactivate();
    expect(networkPolicy.restore).toHaveBeenCalledTimes(1);
    expect(domainRegistry.restore).toHaveBeenCalledTimes(1);
    expect(deviceGuard.restore).toHaveBeenCalledTimes(1);
    expect(mode.status()).toEqual({ active: false, bundleId: null });
  });

  it('is a safe no-op when called while not active', async () => {
    const { mode, networkPolicy } = await buildWorld();
    await mode.deactivate();
    expect(networkPolicy.restore).not.toHaveBeenCalled();
  });
});

describe('createEmergencyMode.search', () => {
  it('rejects searching before activation', async () => {
    const { mode } = await buildWorld();
    await expect(mode.search('x')).rejects.toThrow('emergency_mode_not_active');
  });

  it('returns no results for a query matching nothing', async () => {
    const { mode, bundle } = await buildWorld();
    await mode.activate(bundle.path);
    const result = await mode.search('inexistant');
    expect(result.results).toEqual([]);
  });
});
