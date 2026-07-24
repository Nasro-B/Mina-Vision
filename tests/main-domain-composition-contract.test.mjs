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
      "reportCapability('automation', 'unavailable'",
      // Biométrie faciale : état DYNAMIQUE depuis 2026-07-24 (embedder ONNX réel branché) —
      // available si un modèle est provisionné, sinon unavailable avec raison. Plus un stub figé.
      "reportCapability('biometrics.face', faceEmbedderState, faceEmbedderReason)",
      "reportCapability('personal'",
      "reportCapability('documents'",
      "reportCapability('personality'",
      "reportCapability('code', 'available')",
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
    expect(main).toContain('mina-personality.sqlite');
  });
});
