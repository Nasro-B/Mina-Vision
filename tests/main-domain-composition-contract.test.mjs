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
      "reportCapability('documents', 'degraded', 'document_form_rendering_unavailable')",
      "reportCapability('printing', 'degraded', 'printing_physical_receipt_unverified')",
      "reportCapability('personality'",
      "reportCapability('code', 'available')",
      "reportCapability('voice.local_only', lmStudioProbe.ready ? 'degraded' : 'unavailable', lmStudioProbe.ready ? 'local_voice_end_to_end_unverified' : lmStudioProbe.reason)",
      "reportCapability('sandbox', 'degraded', 'sandbox_physical_isolation_unverified')",
      "reportCapability('avatar.visage', 'unavailable', 'vrm_avatar_out_of_scope')",
      "reportCapability('packaging.local_voice', 'unavailable', 'espeak_distribution_decision_required')",
    ]) {
      expect(main).toContain(needle);
    }
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

  it('starts the Mina runtime before opening the paired-device chat channel', async () => {
    const main = await source();
    const runtimeStart = main.indexOf('await minaCore.start();');
    const chatStart = main.indexOf('await chatChannel.start();');

    expect(runtimeStart).toBeGreaterThan(-1);
    expect(chatStart).toBeGreaterThan(runtimeStart);
  });
});
