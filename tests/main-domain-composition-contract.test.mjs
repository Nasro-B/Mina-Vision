// Contrat de composition (Tasks 8-13 + T19 partiel) : main.mjs DOIT brancher les domaines via
// registerMinaIpc (garde sender + limites de payload), publier le catalogue de vérité runtime,
// et composer réellement personal/documents/personality. Si un refactor débranche l'un d'eux,
// ce contrat casse.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = () => readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');

describe('contrat de composition des domaines (main.mjs)', () => {
  it('registerMinaIpc est LE point d\'enregistrement, avec garde sender et limites de payload', async () => {
    const main = await source();
    expect(main).toContain('registerMinaIpc({');
    expect(main).toContain('event.senderFrame === frame');
    expect(main).toContain('maxPayloadBytes: 1024 * 1024');
    expect(main).toContain("payloadLimits: { 'mina:camera:enroll': 16 * 1024 * 1024 }");
    // Les anciens appels individuels ne reviennent pas.
    expect(main).not.toMatch(/registerMailIpc\(\{ ipcMain, controller: mailController \}\)/u);
  });

  it('le catalogue runtime est publié avec l\'état réel — indisponibilités NOMMÉES, jamais masquées', async () => {
    const main = await source();
    expect(main).toContain('createRuntimeCapabilityCatalog()');
    expect(main).toContain("ipcMain.handle('mina:capabilities:list'");
    for (const needle of [
      // Gouvernance (2026-07-24 soir) : automation/recovery/evaluation/emergency/approvals/
      // connectors sont COMPOSÉS avec leurs vrais fournisseurs — l'état publié vient de la
      // composition elle-même, et l'échec de composition publie unavailable NOMMÉ pour les six.
      'governanceDomains = composeGovernanceDomains({',
      'for (const entry of governanceDomains.capabilities)',
      'reportCapability(entry.domain, entry.state, entry.reason)',
      "for (const domain of ['automation', 'recovery', 'evaluation', 'emergency', 'approvals', 'connectors'])",
      // Biométrie faciale : état DYNAMIQUE depuis 2026-07-24 (embedder ONNX réel branché) —
      // available si un modèle est provisionné, sinon unavailable avec raison. Plus un stub figé.
      "reportCapability('biometrics.face', faceEmbedderState, faceEmbedderReason)",
      "reportCapability('personal'",
      "reportCapability('documents'",
      "reportCapability('documents', 'degraded', 'document_form_commit_conversion_not_configured')",
      "reportCapability('printing', 'degraded', 'printing_physical_receipt_unverified')",
      "reportCapability('personality'",
      "reportCapability('code', 'available')",
      "reportCapability('voice.local_only', lmStudioProbe.ready ? 'degraded' : 'unavailable', lmStudioProbe.ready ? 'local_voice_end_to_end_unverified' : lmStudioProbe.reason)",
      "reportCapability('sandbox', 'degraded', 'sandbox_physical_isolation_unverified')",
      "reportCapability('avatar.visage', 'unavailable', 'vrm_avatar_out_of_scope')",
      'const capability = localVoicePackagingCapability();',
      'reportCapability(capability.id, capability.status, capability.reason)',
    ]) {
      expect(main).toContain(needle);
    }
    expect(main).not.toContain('espeak_distribution_decision_required');
  });

  it('personal, documents et personality sont composés avec des persistances réelles', async () => {
    const main = await source();
    expect(main).toContain('createTodayController({ dailyBriefingService');
    expect(main).toContain('createGraphController({');
    expect(main).toContain('applyPersonalGraphMigrations(personalGraphDatabase)');
    expect(main).toContain('createDocumentController({');
    expect(main).toContain('createPersonalityController({ personalityService })');
    expect(main).toContain('mina-personal-routines.sqlite');
    expect(main).toContain('mina-personal-graph.sqlite');
    expect(main).toContain('mina-document-quarantine.sqlite');
    expect(main).toContain('mina-recovery-closures.sqlite');
    expect(main).toContain('mina-personality.sqlite');
  });

  it('hydrate le registre Home depuis les entités découvertes, pas depuis une liste vide', async () => {
    const main = await source();
    expect(main).toContain("import { discoverSmartHomeDevices } from '../home/home-device-discovery.mjs';");
    expect(main).toContain('const homeDiscovery = await discoverSmartHomeDevices({ connectors: homeDomain.connectors });');
    expect(main).toContain('const homeRegistry = createSmartHomeRegistry({ devices: homeDiscovery.devices });');
    expect(main).not.toContain('const homeRegistry = createSmartHomeRegistry({ devices: [] });');
  });

  it('relie la quarantaine document aux parseurs locaux, aux preuves et à la classification', async () => {
    const main = await source();

    for (const needle of [
      "import { createDocumentParserRegistry } from '../documents/document-parser-registry.mjs';",
      "import { createDocumentEvidenceStore } from '../documents/document-evidence-store.mjs';",
      "import { createDocumentClassifier } from '../documents/document-classifier.mjs';",
      "import { createDocumentMemoryService } from '../documents/document-memory-service.mjs';",
      "import { createDocumentRagRepository } from '../documents/document-rag-repository.mjs';",
      "import { createFormService } from '../documents/form-service.mjs';",
      "import { createDownloadService } from '../documents/download-service.mjs';",
      "import { createHttpDocumentDownloadPort } from '../documents/http-download-port.mjs';",
      "import { createPdfTextDocumentParser, createImageOcrDocumentParser } from '../documents/local-document-parsers.mjs';",
      "import { createPdfPageRasterizer, createPdfScannedOcrFallback } from '../documents/pdf-scanned-ocr.mjs';",
      "import { createPdfTextExtractor } from '../research/pdf-text-extractor.mjs';",
      'const documentQuarantineStore = createDocumentQuarantineStore({',
      'getEncryptionKey: () => deriveDocumentQuarantineKey(chatMasterKey),',
      'const documentOcrProvider = createTesseractOcrProvider();',
      'const documentPdfOcrFallback = createPdfScannedOcrFallback({',
      'rasterizePdfPages: createPdfPageRasterizer(),',
      'ocrProvider: documentOcrProvider,',
      'createDocumentParserRegistry({',
      'createPdfTextDocumentParser({',
      'ocrFallback: documentPdfOcrFallback,',
      'createImageOcrDocumentParser({ ocrProvider: documentOcrProvider })',
      'createDocumentEvidenceStore({',
      "storageMode: 'metadata-only',",
      'createDocumentClassifier({',
      'createDocumentRagRepository({',
      'getEncryptionKey: () => deriveDocumentRagKey(chatMasterKey),',
      'createDocumentMemoryService({',
      'const documentFormService = createFormService({',
      'formRenderer: null,',
      'const documentDownloadService = createDownloadService({',
      'browserDownloadPort: createHttpDocumentDownloadPort(),',
      'evidenceStore,',
      'formService: documentFormService,',
      'downloadService: documentDownloadService,',
      'classifier,',
      'memoryService: documentMemoryService,',
      'sourceStore: documentQuarantineStore,',
      'void documentMemoryService.purgeExpiredDocuments()',
      'mina-document-evidence.sqlite',
      'mina-document-classifications.sqlite',
      'mina-document-rag.sqlite',
    ]) {
      expect(main).toContain(needle);
    }
  });

  it('publie le domaine urgence composé via le contrôleur IPC', async () => {
    const main = await source();

    expect(main).toContain("import { createEmergencyController } from './pages/emergency-controller.mjs';");
    expect(main).toContain('let emergencyController = null;');
    expect(main).toContain('governanceDomains.emergency && governanceDomains.emergencyCorpus');
    expect(main).toContain('emergencyController = createEmergencyController({');
    expect(main).toContain('...(emergencyController ? { emergency: emergencyController } : {}),');
  });

  it('starts the Mina runtime before opening the paired-device chat channel', async () => {
    const main = await source();
    const runtimeStart = main.indexOf('await minaCore.start();');
    const chatStart = main.indexOf('await chatChannel.start();');

    expect(runtimeStart).toBeGreaterThan(-1);
    expect(chatStart).toBeGreaterThan(runtimeStart);
  });
});
