import { describe, expect, it } from 'vitest';
import { createAstParser } from '../../src/code/intelligence/ast-parser.mjs';
import { createDependencyGraph } from '../../src/code/intelligence/dependency-graph.mjs';
import { createDiffEngine } from '../../src/code/editing/diff-engine.mjs';
import { createFileBackup } from '../../src/code/editing/file-backup.mjs';
import { createPatchApplier } from '../../src/code/editing/patch-applier.mjs';
import { createRefactorWorkspace } from '../../src/code/editing/refactor-workspace.mjs';

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

const patchFor = (file, from, to) => `*** Begin Patch
*** Update File: ${file}
-${from}
+${to}
*** End Patch`;

function buildWorkspace(initialFiles, { testRunner = null, withGraph = false } = {}) {
  const memFs = createMemFs(initialFiles);
  const fileBackup = createFileBackup({ fs: memFs });
  const diffEngine = createDiffEngine({ fs: memFs, fileBackup });
  const patchApplier = createPatchApplier({ diffEngine, fileBackup, astParser: createAstParser(), fs: memFs });
  let dependencyGraph = null;
  if (withGraph) {
    dependencyGraph = createDependencyGraph();
    dependencyGraph.setFile('app.mjs', ['lib.mjs']);
  }
  const workspace = createRefactorWorkspace({ patchApplier, dependencyGraph, fileBackup, testRunner, fs: memFs });
  return { workspace, memFs };
}

describe('refactor-workspace', () => {
  it('exige applier, backup, fs et un plan valide', async () => {
    expect(() => createRefactorWorkspace({})).toThrow(/patch_applier_required/u);
    const { workspace } = buildWorkspace({});
    await expect(workspace.execute({})).rejects.toThrow(/plan_required/u);
    await expect(workspace.execute({ plan: { patches: [{ file: 'a.mjs' }] } })).rejects.toThrow(/patch_entry_invalid/u);
  });

  it('applique un plan multi-fichier avec succès', async () => {
    const { workspace, memFs } = buildWorkspace({
      'lib.mjs': 'export const lib = 1;',
      'app.mjs': 'export const app = 1;',
    });
    const result = await workspace.execute({
      plan: {
        patches: [
          { file: 'lib.mjs', patch: patchFor('lib.mjs', 'export const lib = 1;', 'export const lib = 2;') },
          { file: 'app.mjs', patch: patchFor('app.mjs', 'export const app = 1;', 'export const app = 2;') },
        ],
      },
      verifyTests: false,
    });
    expect(result.success).toBe(true);
    expect(result.filesChanged).toBe(2);
    expect(memFs.files.get('lib.mjs')).toContain('lib = 2');
    expect(memFs.files.get('app.mjs')).toContain('app = 2');
  });

  it('ordonne par le graphe de dépendances : lib avant app', async () => {
    const { workspace } = buildWorkspace({
      'lib.mjs': 'export const lib = 1;',
      'app.mjs': 'export const app = 1;',
    }, { withGraph: true });
    const result = await workspace.execute({
      plan: {
        patches: [
          { file: 'app.mjs', patch: patchFor('app.mjs', 'export const app = 1;', 'export const app = 2;') },
          { file: 'lib.mjs', patch: patchFor('lib.mjs', 'export const lib = 1;', 'export const lib = 2;') },
        ],
      },
      verifyTests: false,
    });
    expect(result.results.map((entry) => entry.file)).toEqual(['lib.mjs', 'app.mjs']);
  });

  it('mode atomic : un échec → rollback de TOUS les fichiers déjà modifiés', async () => {
    const { workspace, memFs } = buildWorkspace({
      'lib.mjs': 'export const lib = 1;',
      'app.mjs': 'export const app = 1;',
    });
    const result = await workspace.execute({
      plan: {
        patches: [
          { file: 'lib.mjs', patch: patchFor('lib.mjs', 'export const lib = 1;', 'export const lib = 2;') },
          { file: 'app.mjs', patch: patchFor('app.mjs', 'contexte-inexistant', 'x') },
        ],
      },
      verifyTests: false,
      atomic: true,
    });
    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.reason).toMatch(/refactor_atomic_rollback/u);
    expect(memFs.files.get('lib.mjs')).toBe('export const lib = 1;');
  });

  it('mode non-atomic : continue après échec et rapporte fichier par fichier', async () => {
    const { workspace, memFs } = buildWorkspace({
      'lib.mjs': 'export const lib = 1;',
      'app.mjs': 'export const app = 1;',
    });
    const result = await workspace.execute({
      plan: {
        patches: [
          { file: 'lib.mjs', patch: patchFor('lib.mjs', 'contexte-inexistant', 'x') },
          { file: 'app.mjs', patch: patchFor('app.mjs', 'export const app = 1;', 'export const app = 2;') },
        ],
      },
      verifyTests: false,
      atomic: false,
    });
    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(false);
    expect(result.results).toEqual([
      expect.objectContaining({ file: 'lib.mjs', success: false }),
      expect.objectContaining({ file: 'app.mjs', success: true }),
    ]);
    expect(memFs.files.get('app.mjs')).toContain('app = 2');
  });

  it('verifyTests + rouge + atomic → rollback complet', async () => {
    const testRunner = { runAll: async () => ({ passed: 10, failed: 2 }) };
    const { workspace, memFs } = buildWorkspace({ 'lib.mjs': 'export const lib = 1;' }, { testRunner });
    const result = await workspace.execute({
      plan: { patches: [{ file: 'lib.mjs', patch: patchFor('lib.mjs', 'export const lib = 1;', 'export const lib = 2;') }] },
      verifyTests: true,
      atomic: true,
    });
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/refactor_tests_failed: 2/u);
    expect(memFs.files.get('lib.mjs')).toBe('export const lib = 1;');
  });

  it('verifyTests + vert → succès avec rapport de tests', async () => {
    const testRunner = { runAll: async () => ({ passed: 12, failed: 0 }) };
    const { workspace } = buildWorkspace({ 'lib.mjs': 'export const lib = 1;' }, { testRunner });
    const result = await workspace.execute({
      plan: { patches: [{ file: 'lib.mjs', patch: patchFor('lib.mjs', 'export const lib = 1;', 'export const lib = 2;') }] },
    });
    expect(result.success).toBe(true);
    expect(result.tests).toMatchObject({ passed: 12, failed: 0 });
  });
});
