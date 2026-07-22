import { describe, expect, it } from 'vitest';
import {
  applyHunksToContent,
  createDiffEngine,
  parseMinaPatch,
} from '../../src/code/editing/diff-engine.mjs';
import { createFileBackup } from '../../src/code/editing/file-backup.mjs';

function createMemFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async (path) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path);
    },
    writeFile: async (path, content) => { files.set(path, content); },
    rm: async (path, { force } = {}) => {
      if (!files.has(path) && !force) throw new Error(`ENOENT: ${path}`);
      files.delete(path);
    },
  };
}

const PATCH_UPDATE = `*** Begin Patch
*** Update File: src/app.mjs
 function saluer() {
-  return 'bonjour';
+  return 'bonsoir';
 }
*** End Patch`;

describe('diff-engine — parseMinaPatch', () => {
  it('parse un patch update avec contexte, suppressions et ajouts', () => {
    const files = parseMinaPatch(PATCH_UPDATE);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ file: 'src/app.mjs', operation: 'update' });
    expect(files[0].hunks[0].removals).toEqual(["  return 'bonjour';"]);
    expect(files[0].hunks[0].additions).toEqual(["  return 'bonsoir';"]);
  });

  it('parse Add File et Delete File', () => {
    const files = parseMinaPatch(`*** Begin Patch
*** Add File: nouveau.mjs
+export const x = 1;
*** Delete File: obsolete.mjs
*** End Patch`);
    expect(files.map((entry) => entry.operation)).toEqual(['add', 'delete']);
  });

  it('sépare les hunks sur les marqueurs @@', () => {
    const files = parseMinaPatch(`*** Begin Patch
*** Update File: a.mjs
@@ premier @@
 contexte1
-vieux1
+neuf1
@@ second @@
 contexte2
-vieux2
+neuf2
*** End Patch`);
    expect(files[0].hunks).toHaveLength(2);
  });

  it.each([
    ['', 'marqueurs Begin\\/End'],
    ['*** Begin Patch\n*** End Patch', 'aucun fichier'],
    ['*** Begin Patch\n+orpheline\n*** End Patch', 'hors section'],
    ['*** Begin Patch\n*** Update File: a.mjs\n*** End Patch', 'aucune modification'],
    ['*** Begin Patch\n*** Update File: \n-x\n*** End Patch', 'chemin de fichier vide'],
  ])('rejette un patch malformé (%#)', (patch, messagePattern) => {
    expect(() => parseMinaPatch(patch)).toThrow(new RegExp(messagePattern, 'u'));
  });
});

describe('diff-engine — applyHunksToContent', () => {
  it('applique par ancrage de contexte', () => {
    const content = "function saluer() {\n  return 'bonjour';\n}";
    const [file] = parseMinaPatch(PATCH_UPDATE);
    expect(applyHunksToContent(content, file.hunks)).toBe("function saluer() {\n  return 'bonsoir';\n}");
  });

  it('contexte introuvable → code_diff_apply_context_not_found', () => {
    const [file] = parseMinaPatch(PATCH_UPDATE);
    expect(() => applyHunksToContent('rien à voir', file.hunks, 'a.mjs'))
      .toThrow(/code_diff_apply_context_not_found/u);
  });

  it('contexte ambigu (2 occurrences) → code_diff_apply_ambiguous', () => {
    const [file] = parseMinaPatch(`*** Begin Patch
*** Update File: a.mjs
-doublon
+unique
*** End Patch`);
    expect(() => applyHunksToContent('doublon\nautre\ndoublon', file.hunks, 'a.mjs'))
      .toThrow(/code_diff_apply_ambiguous/u);
  });

  it('hunk sans contexte ni suppression = ajout en fin de fichier', () => {
    const [file] = parseMinaPatch(`*** Begin Patch
*** Update File: a.mjs
+nouvelle ligne
*** End Patch`);
    expect(applyHunksToContent('existante', file.hunks)).toBe('existante\nnouvelle ligne');
  });
});

describe('diff-engine — diff structuré et format unifié', () => {
  const engine = createDiffEngine();

  it('compte ajouts et suppressions', () => {
    const result = engine.diff({ original: 'a\nb\nc\n', modified: 'a\nX\nc\nd\n', filePath: 'x.mjs' });
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(1);
    expect(result.filePath).toBe('x.mjs');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('formatUnified produit un diff lisible avec en-têtes a/ b/', () => {
    const result = engine.diff({ original: 'a', modified: 'b', filePath: 'x.mjs' });
    const text = engine.formatUnified(result);
    expect(text).toContain('--- a/x.mjs');
    expect(text).toContain('+++ b/x.mjs');
    expect(text).toContain('-a');
    expect(text).toContain('+b');
  });
});

describe('diff-engine — applyPatch avec fs et rollback', () => {
  it('exige un fs pour appliquer', async () => {
    const engine = createDiffEngine();
    await expect(engine.applyPatch({ patch: PATCH_UPDATE })).rejects.toThrow(/code_diff_fs_required/u);
  });

  it('applique update + add + delete et journalise les opérations', async () => {
    const memFs = createMemFs({
      'src/app.mjs': "function saluer() {\n  return 'bonjour';\n}",
      'obsolete.mjs': 'vieux',
    });
    const fileBackup = createFileBackup({ fs: memFs });
    const engine = createDiffEngine({ fs: memFs, fileBackup });
    const result = await engine.applyPatch({
      patch: `*** Begin Patch
*** Update File: src/app.mjs
-  return 'bonjour';
+  return 'bonsoir';
*** Add File: nouveau.mjs
+export const x = 1;
*** Delete File: obsolete.mjs
*** End Patch`,
    });
    expect(result.applied.map((entry) => entry.operation)).toEqual(['update', 'add', 'delete']);
    expect(memFs.files.get('src/app.mjs')).toContain('bonsoir');
    expect(memFs.files.get('nouveau.mjs')).toBe('export const x = 1;');
    expect(memFs.files.has('obsolete.mjs')).toBe(false);
  });

  it('échec en cours de patch → rollback des fichiers déjà modifiés', async () => {
    const memFs = createMemFs({ 'a.mjs': 'ligne-a', 'b.mjs': 'autre chose' });
    const fileBackup = createFileBackup({ fs: memFs });
    const engine = createDiffEngine({ fs: memFs, fileBackup });
    await expect(engine.applyPatch({
      patch: `*** Begin Patch
*** Update File: a.mjs
-ligne-a
+ligne-a-modifiée
*** Update File: b.mjs
-contexte-introuvable
+jamais
*** End Patch`,
    })).rejects.toThrow(/code_diff_apply_failed/u);
    expect(memFs.files.get('a.mjs')).toBe('ligne-a');
  });

  it('validatePatch signale les erreurs sans modifier les fichiers', async () => {
    const memFs = createMemFs({ 'a.mjs': 'contenu' });
    const engine = createDiffEngine({ fs: memFs });
    const invalid = await engine.validatePatch({ patch: 'pas un patch' });
    expect(invalid.valid).toBe(false);
    const notFound = await engine.validatePatch({
      patch: '*** Begin Patch\n*** Update File: a.mjs\n-absent\n+x\n*** End Patch',
    });
    expect(notFound.valid).toBe(false);
    expect(notFound.errors[0]).toMatch(/context_not_found/u);
    const ok = await engine.validatePatch({
      patch: '*** Begin Patch\n*** Update File: a.mjs\n-contenu\n+nouveau\n*** End Patch',
    });
    expect(ok.valid).toBe(true);
    expect(memFs.files.get('a.mjs')).toBe('contenu');
  });

  it('revertLastPatch restaure via le backup', async () => {
    const memFs = createMemFs({ 'a.mjs': 'original' });
    const fileBackup = createFileBackup({ fs: memFs });
    const engine = createDiffEngine({ fs: memFs, fileBackup });
    await engine.applyPatch({ patch: '*** Begin Patch\n*** Update File: a.mjs\n-original\n+modifié\n*** End Patch' });
    expect(memFs.files.get('a.mjs')).toBe('modifié');
    await engine.revertLastPatch('a.mjs');
    expect(memFs.files.get('a.mjs')).toBe('original');
    const sansBackup = createDiffEngine({ fs: memFs });
    await expect(sansBackup.revertLastPatch('a.mjs')).rejects.toThrow(/code_diff_backup_required/u);
  });
});
