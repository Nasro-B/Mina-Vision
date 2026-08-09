import { describe, expect, it, vi } from 'vitest';
import { createDocumentIntake } from '../src/documents/document-intake.mjs';
import { createDocumentQuarantineStore } from '../src/documents/document-quarantine.mjs';
import { createEmergencyCorpus } from '../src/emergency/emergency-corpus.mjs';
import { createEmergencyMode } from '../src/emergency/emergency-mode.mjs';
import { createDocumentController } from '../src/ui/pages/document-controller.mjs';
import { createEmergencyController } from '../src/ui/pages/emergency-controller.mjs';
import { registerDocumentIpc } from '../src/ui/ipc/document-ipc.mjs';
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
  const resolve = vi.fn(async (path) => path);
  return { resolve, resolveDestination: resolve };
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

describe('document controller: unavailable form rendering is explicit', () => {
  it('rejects committing a filled-form copy when no real renderer is composed', async () => {
    const { documentController } = buildDocumentWorld();

    await expect(documentController.commitFormCopy('proposal-1')).rejects.toThrow('document_form_rendering_unavailable');
  });

  it('refuses every other non-composed operation instead of returning undefined', () => {
    const { documentController } = buildDocumentWorld();

    expect(() => documentController.proposeClassification({})).toThrow('document_classifier_not_configured');
    expect(() => documentController.confirmClassification('proposal-1')).toThrow('document_classifier_not_configured');
    expect(() => documentController.indexSelection({ proposalId: 'proposal-1', blockIds: [] })).toThrow('document_memory_not_configured');
    expect(() => documentController.forgetDocument('document-1')).toThrow('document_memory_not_configured');
    expect(() => documentController.proposeFill({ documentId: 'document-1', values: {} })).toThrow('document_form_rendering_unavailable');
    expect(() => documentController.renderFormPreview('proposal-1')).toThrow('document_form_rendering_unavailable');
    expect(() => documentController.convertDocument({})).toThrow('document_converter_not_configured');
    expect(() => documentController.downloadDocument({})).toThrow('document_download_not_configured');
    expect(() => documentController.discoverPrinters()).toThrow('printer_registry_not_configured');
    expect(() => documentController.approvePrinter('printer-1')).toThrow('printer_registry_not_configured');
    expect(() => documentController.proposePrint({})).toThrow('print_service_not_configured');
    expect(() => documentController.submitPrint({})).toThrow('print_service_not_configured');
    expect(() => documentController.reconcilePrint('job-1')).toThrow('print_service_not_configured');
  });
});

describe('document controller: classification uses persisted evidence', () => {
  it('classifies the observation stored for the document, never an observation supplied by the renderer', async () => {
    const { intake } = buildDocumentWorld();
    const observation = Object.freeze({ documentId: 'document-1', mediaType: 'application/pdf', blocks: [] });
    const controller = createDocumentController({
      intake,
      evidenceStore: { get: async (documentId) => (documentId === 'document-1' ? observation : null) },
      classifier: {
        proposeClassification: async (storedObservation, hints) => Object.freeze({
          documentId: storedObservation.documentId,
          category: hints.category,
        }),
      },
    });

    await expect(controller.proposeClassificationForDocument('document-1', { category: 'invoice' }))
      .resolves.toEqual({ documentId: 'document-1', category: 'invoice' });
    await expect(controller.proposeClassificationForDocument('missing', { category: 'invoice' }))
      .rejects.toThrow('document_not_parsed');
  });

  it('routes the IPC classification request by documentId and ignores a renderer-supplied observation', async () => {
    const handlers = new Map();
    registerDocumentIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      controller: {
        proposeClassificationForDocument: async (documentId, hints) => Object.freeze({
          documentId,
          category: hints.category,
        }),
      },
    });

    await expect(handlers.get('mina:documents:propose-classification')({}, {
      documentId: 'document-1',
      observation: { documentId: 'injected-document' },
      hints: { category: 'invoice' },
    })).resolves.toEqual({ documentId: 'document-1', category: 'invoice' });
  });

  it('routes the read-only quarantine list through a named IPC channel', async () => {
    const handlers = new Map();
    registerDocumentIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      controller: { listDocuments: async () => Object.freeze([{ documentId: 'document-1', declaredName: 'facture.pdf' }]) },
    });

    await expect(handlers.get('mina:documents:list')({}))
      .resolves.toEqual([{ documentId: 'document-1', declaredName: 'facture.pdf' }]);
  });
});

describe('document controller: parse response is redacted for the renderer', () => {
  it('stores full evidence locally but returns only metadata and a block count', async () => {
    const { intake } = buildDocumentWorld();
    let stored = null;
    const controller = createDocumentController({
      intake,
      parserRegistry: {
        parse: async () => ({
          documentId: 'document-1', mediaType: 'application/pdf', pageCount: 1,
          parserId: 'pdf-text-parser', parserVersion: '1', confidence: 0.94,
          blocks: [{ text: 'Donnée personnelle à ne pas envoyer au renderer', sourceOffset: { page: 1 }, confidence: 0.94 }],
        }),
      },
      evidenceStore: { store: async (observation) => { stored = observation; } },
    });

    const response = await controller.parseDocument('document-1');

    expect(stored.blocks[0].text).toBe('Donnée personnelle à ne pas envoyer au renderer');
    expect(response).toEqual({
      documentId: 'document-1', mediaType: 'application/pdf', pageCount: 1,
      parserId: 'pdf-text-parser', parserVersion: '1', confidence: 0.94, blockCount: 1,
    });
    expect(JSON.stringify(response)).not.toContain('Donnée personnelle');
    expect(response).not.toHaveProperty('blocks');
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
    expect(channels).toContain('mina:documents:list');
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

  it('lists quarantine metadata without exposing digests or raw bytes', async () => {
    const { documentController } = buildDocumentWorld();
    await documentController.intakeDocument({ source: 'download', bytes: Buffer.from('%PDF-1.7 mock'), declaredName: 'facture.pdf' });

    const listed = await documentController.listDocuments();

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      declaredName: 'facture.pdf', detectedType: 'application/pdf', size: 13, status: 'inspectable',
    });
    expect(listed[0]).not.toHaveProperty('digest');
    expect(JSON.stringify(listed)).not.toContain('%PDF');
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
