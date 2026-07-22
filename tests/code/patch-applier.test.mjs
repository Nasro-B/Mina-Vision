import { describe, expect, it } from 'vitest';
import { createAstParser } from '../../src/code/intelligence/ast-parser.mjs';
import { createDiffEngine } from '../../src/code/editing/diff-engine.mjs';
import { createFileBackup } from '../../src/code/editing/file-backup.mjs';
import { createPatchApplier } from '../../src/code/editing/patch-applier.mjs';

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

function buildApplier(initialFiles, { formatter = null, lint = null } = {}) {
  const memFs = createMemFs(initialFiles);
  const fileBackup = createFileBackup({ fs: memFs });
  const diffEngine = createDiffEngine({ fs: memFs, fileBackup });
  const applier = createPatchApplier({
    diffEngine,
    fileBackup,
    astParser: createAstParser(),
    codeFormatter: formatter,
    lintRunner: lint,
    fs: memFs,
  });
  return { applier, memFs };
}

const VALID_PATCH = `*** Begin Patch
*** Update File: src/app.mjs
-export const version = 1;
+export const version = 2;
*** End Patch`;

describe('patch-applier', () => {
  it('exige diffEngine, backup et fs', () => {
    expect(() => createPatchApplier({})).toThrow(/diff_engine_required/u);
    const memFs = createMemFs();
    const fileBackup = createFileBackup({ fs: memFs });
    expect(() => createPatchApplier({ diffEngine: createDiffEngine(), fileBackup })).toThrow(/fs_required/u);
  });

  it('applique un patch valide et laisse un backup restaurable', async () => {
    const { applier, memFs } = buildApplier({ 'src/app.mjs': 'export const version = 1;' });
    const result = await applier.apply({ patches: VALID_PATCH });
    expect(result.applied[0]).toMatchObject({ file: 'src/app.mjs', operation: 'update' });
    expect(memFs.files.get('src/app.mjs')).toBe('export const version = 2;');
    expect(memFs.files.get('src/app.mjs.mina-backup')).toBe('export const version = 1;');
  });

  it('dryRun prévisualise sans rien écrire', async () => {
    const { applier, memFs } = buildApplier({ 'src/app.mjs': 'export const version = 1;' });
    const result = await applier.apply({ patches: VALID_PATCH, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.preview[0]).toMatchObject({ file: 'src/app.mjs', additions: 1, deletions: 1 });
    expect(memFs.files.get('src/app.mjs')).toBe('export const version = 1;');
    expect(memFs.files.has('src/app.mjs.mina-backup')).toBe(false);
  });

  it('refuse les fichiers binaires AVANT toute écriture', async () => {
    const { applier } = buildApplier({});
    await expect(applier.apply({
      patches: '*** Begin Patch\n*** Update File: image.png\n-x\n+y\n*** End Patch',
    })).rejects.toThrow(/patch_applier_binary_refused/u);
  });

  it('AST invalide après édition → rollback complet + erreur nominée', async () => {
    const { applier, memFs } = buildApplier({ 'src/app.mjs': 'export const version = 1;' });
    await expect(applier.apply({
      patches: `*** Begin Patch
*** Update File: src/app.mjs
-export const version = 1;
+export const version = {{{cassé;
*** End Patch`,
    })).rejects.toThrow(/patch_applier_ast_invalid/u);
    expect(memFs.files.get('src/app.mjs')).toBe('export const version = 1;');
  });

  it('AST invalide sur un fichier AJOUTÉ → le fichier ajouté est supprimé au rollback', async () => {
    const { applier, memFs } = buildApplier({});
    await expect(applier.apply({
      patches: '*** Begin Patch\n*** Add File: neuf.mjs\n+function {\n*** End Patch',
    })).rejects.toThrow(/patch_applier_ast_invalid/u);
    expect(memFs.files.has('neuf.mjs')).toBe(false);
  });

  it('les fichiers non-JS (md, css) ne passent pas par la validation AST', async () => {
    const { applier, memFs } = buildApplier({ 'notes.md': 'ancien' });
    await applier.apply({
      patches: '*** Begin Patch\n*** Update File: notes.md\n-ancien\n+function { pas du js mais du texte\n*** End Patch',
    });
    expect(memFs.files.get('notes.md')).toContain('pas du js');
  });

  it('formatage et lint appelés UNIQUEMENT sur les fichiers touchés', async () => {
    const formatterCalls = [];
    const lintCalls = [];
    const { applier } = buildApplier(
      { 'src/app.mjs': 'export const version = 1;' },
      {
        formatter: { format: async ({ files }) => { formatterCalls.push(files); return { formatted: files }; } },
        lint: { lint: async ({ files }) => { lintCalls.push(files); return { findings: [] }; } },
      },
    );
    await applier.apply({ patches: VALID_PATCH });
    expect(formatterCalls).toEqual([['src/app.mjs']]);
    expect(lintCalls).toEqual([['src/app.mjs']]);
  });

  it('reformat=false et lint=false court-circuitent la chaîne', async () => {
    let called = 0;
    const { applier } = buildApplier(
      { 'src/app.mjs': 'export const version = 1;' },
      { formatter: { format: async () => { called += 1; return {}; } }, lint: { lint: async () => { called += 1; return {}; } } },
    );
    await applier.apply({ patches: VALID_PATCH, reformat: false, lint: false });
    expect(called).toBe(0);
  });

  it('une panne du formateur ne casse jamais l\'application du patch', async () => {
    const { applier, memFs } = buildApplier(
      { 'src/app.mjs': 'export const version = 1;' },
      { formatter: { format: async () => { throw new Error('prettier絶望'); } } },
    );
    const result = await applier.apply({ patches: VALID_PATCH });
    expect(memFs.files.get('src/app.mjs')).toBe('export const version = 2;');
    expect(result.formatting.reason).toMatch(/formatter_failed/u);
  });

  it('valide l\'entrée patches', async () => {
    const { applier } = buildApplier({});
    await expect(applier.apply({})).rejects.toThrow(/patches_required/u);
    await expect(applier.apply({ patches: '   ' })).rejects.toThrow(/patches_required/u);
  });
});
