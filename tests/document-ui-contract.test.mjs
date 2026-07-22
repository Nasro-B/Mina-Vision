import { describe, expect, it, vi } from 'vitest';
import { createDocumentIntake } from '../src/documents/document-intake.mjs';
import { createDocumentQuarantineStore } from '../src/documents/document-quarantine.mjs';
import { createEmergencyCorpus } from '../src/emergency/emergency-corpus.mjs';
import { createEmergencyMode } from '../src/emergency/emergency-mode.mjs';
import { createDocumentController } from '../src/ui/pages/document-controller.mjs';
import { createEmergencyController } from '../src/ui/pages/emergency-controller.mjs';
import { registerMinaIpc, CORE_CHANNELS } from '../src/ui/ipc/register-ipc.mjs';

function fakeIpcMain() {
  const handlers = new Map();
  return { handle: vi.fn((channel, handler) => handlers.set(channel, handler)) };
}

function fakeFilesystem() {
  const files = new Map();
  return { files, writeFile: vi.fn(async (path, bytes) => files.set(path, bytes)), readFile: vi.fn(async (path) => files.get(path) ?? Buffer.alloc(0)) };
}

function passthroughRealpath() {
  return { resolve: vi.fn(async (path) => path) };
}

function buildDocumentWorld() {
  const quarantineStore = createDocumentQuarantineStore({ filesystem: fakeFilesystem(), repository: (() => {
    const rows = new Map();
    return { put: vi.fn(async (id, r) => rows.set(id, r)), get: vi.fn(async (id) => rows.get(id) ?? null), list: vi.fn(async () => [...rows.values()]) };
  })() });
  const intake = createDocumentIntake({ quarantineStore, filesystem: fakeFilesystem(), realpathProvider: passthroughRealpath(), clock: () => 1_700_000_000_000 });
  return { documentController: createDocumentController({ intake }), intake };
}

function buildEmergencyWorld() {
  const keyring = { open: vi.fn(async () => Buffer.alloc(32, 7)) };
  const filesystem = fakeFilesystem();
  const exporter = { sourceId: 'contacts', export: vi.fn(async (ids) => ids.map((id) => ({ itemId: id, classification: 'sensitive', payload: 'x' }))) };
  const corpus = createEmergencyCorpus({ keyring, exporters: [exporter], filesystem, clock: () => 1_700_000_000_000 });
  const networkPolicy = { disableAll: vi.fn(async () => {}), restore: vi.fn(async () => {}) };
  const domainRegistry = { disableExternal: vi.fn(async () => {}), restore: vi.fn(async () => {}) };
  const deviceGuard = { disableCameraAndMic: vi.fn(async () => {}), restore: vi.fn(async () => {}) };
  const mode = createEmergencyMode({ corpus, networkPolicy, domainRegistry, deviceGuard, clock: () => 1_700_000_000_000 });
  return { emergencyController: createEmergencyController({ corpus, mode }), corpus };
}

describe('document/emergency controllers: constructor guards', () => {
  it('createDocumentController requires its dependencies', () => {
    expect(() => createDocumentController({})).toThrow('document_controller_dependencies_required');
  });

  it('createEmergencyController requires its dependencies', () => {
    expect(() => createEmergencyController({})).toThrow();
  });
});

describe('IPC channel allowlist: named channels only, never a raw write escape hatch', () => {
  it('registers the documented mina:documents:*/mina:printing:*/mina:emergency:* channels', () => {
    const { documentController } = buildDocumentWorld();
    const { emergencyController } = buildEmergencyWorld();
    const ipcMain = fakeIpcMain();
    const { channels } = registerMinaIpc({
      ipcMain, coreChannels: CORE_CHANNELS,
      controllers: { document: documentController, emergency: emergencyController },
    });
    expect(channels).toContain('mina:documents:get');
    expect(channels).toContain('mina:documents:intake');
    expect(channels).toContain('mina:printing:submit');
    expect(channels).toContain('mina:emergency:activate');
  });

  it('never registers a raw-write escape hatch for documents', () => {
    const { documentController } = buildDocumentWorld();
    const { emergencyController } = buildEmergencyWorld();
    const ipcMain = fakeIpcMain();
    const { channels } = registerMinaIpc({
      ipcMain, coreChannels: CORE_CHANNELS,
      controllers: { document: documentController, emergency: emergencyController },
    });
    expect(channels).not.toContain('mina:documents:write-raw');
  });
});

describe('document-controller.getDocument: renderer never receives raw bytes', () => {
  it('the redacted document DTO never carries rawBytes', async () => {
    const { documentController } = buildDocumentWorld();
    const item = await documentController.intakeDocument({ source: 'download', bytes: Buffer.from('%PDF-1.7 mock'), declaredName: 'facture.pdf' });
    const fetched = await documentController.getDocument(item.documentId);
    expect(fetched).not.toHaveProperty('rawBytes');
    expect(JSON.stringify(fetched)).not.toContain('%PDF');
  });

  it('returns null for an unknown document rather than throwing', async () => {
    const { documentController } = buildDocumentWorld();
    expect(await documentController.getDocument('missing')).toBeNull();
  });
});

describe('emergency-controller.status: exposes network disabled/enabled, never raw internals', () => {
  it('reports network disabled once activated', async () => {
    const { emergencyController } = buildEmergencyWorld();
    const bundle = await emergencyController.buildCorpus([{ sourceId: 'contacts', itemIds: ['c1'] }]);
    await emergencyController.activate(bundle.path);
    expect(await emergencyController.status()).toMatchObject({ network: 'disabled' });
  });

  it('reports network enabled before activation', async () => {
    const { emergencyController } = buildEmergencyWorld();
    expect(await emergencyController.status()).toMatchObject({ network: 'enabled' });
  });

  it('reports network enabled again after deactivation', async () => {
    const { emergencyController } = buildEmergencyWorld();
    const bundle = await emergencyController.buildCorpus([{ sourceId: 'contacts', itemIds: ['c1'] }]);
    await emergencyController.activate(bundle.path);
    await emergencyController.deactivate();
    expect(await emergencyController.status()).toMatchObject({ network: 'enabled' });
  });
});

describe('document-controller: end to end with real Task 1 intake', () => {
  it('intake -> get -> promote works through the controller', async () => {
    const { documentController } = buildDocumentWorld();
    const item = await documentController.intakeDocument({ source: 'download', bytes: Buffer.from('%PDF-1.7 mock'), declaredName: 'facture.pdf' });
    expect(item.status).toBe('inspectable');
    const promoted = await documentController.promoteDocument({ documentId: item.documentId, destination: 'out/facture.pdf' });
    expect(promoted.promoted).toBe(true);
  });
});
