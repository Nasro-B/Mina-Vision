import { describe, expect, it } from 'vitest';
import { createAstParser } from '../../src/code/intelligence/ast-parser.mjs';
import { createCallGraph } from '../../src/code/intelligence/call-graph.mjs';
import { createCodebaseIndexer } from '../../src/code/intelligence/codebase-indexer.mjs';
import { createDependencyGraph } from '../../src/code/intelligence/dependency-graph.mjs';
import { createSymbolIndex } from '../../src/code/intelligence/symbol-index.mjs';

const ROOT = 'C:/projets/demo';

function createFakeFs(files, directories) {
  return {
    readFile: async (path) => {
      const normalized = path.replace(/\\/gu, '/');
      if (normalized in files) return files[normalized];
      throw new Error('ENOENT');
    },
    readdir: async (path) => {
      const normalized = path.replace(/\\/gu, '/');
      if (!(normalized in directories)) throw new Error('ENOENT');
      return directories[normalized].map((entry) => ({
        name: entry.name,
        isDirectory: () => entry.type === 'dir',
        isSymbolicLink: () => entry.type === 'symlink',
      }));
    },
  };
}

function buildIndexer({ files, directories, vectorStore = null }) {
  const symbolIndex = createSymbolIndex();
  const callGraph = createCallGraph();
  const dependencyGraph = createDependencyGraph();
  const indexer = createCodebaseIndexer({
    astParser: createAstParser(),
    callGraph,
    dependencyGraph,
    symbolIndex,
    vectorStore,
    fileReader: createFakeFs(files, directories),
    projectRoot: ROOT,
  });
  return { indexer, symbolIndex, callGraph, dependencyGraph };
}

const PROJECT_FILES = {
  [`${ROOT}/src/lib.mjs`]: 'export function aide() { return 1; }',
  [`${ROOT}/src/service.mjs`]: "import { aide } from './lib.mjs';\nexport function servir() { return aide(); }",
  [`${ROOT}/src/casse.mjs`]: 'function {',
};
const PROJECT_DIRECTORIES = {
  [ROOT]: [
    { name: 'src', type: 'dir' },
    { name: 'node_modules', type: 'dir' },
    { name: 'lien', type: 'symlink' },
    { name: 'notes.txt', type: 'file' },
  ],
  [`${ROOT}/src`]: [
    { name: 'lib.mjs', type: 'file' },
    { name: 'service.mjs', type: 'file' },
    { name: 'casse.mjs', type: 'file' },
  ],
};

describe('codebase-indexer', () => {
  it('exige ses dépendances', () => {
    expect(() => createCodebaseIndexer({})).toThrow(/dependencies_required/u);
  });

  it('fullIndex parcourt le projet en ignorant node_modules, symlinks et fichiers non-JS', async () => {
    const { indexer } = buildIndexer({ files: PROJECT_FILES, directories: PROJECT_DIRECTORIES });
    const progress = [];
    const report = await indexer.fullIndex({ onProgress: (entry) => progress.push(entry.file) });
    expect(report.total).toBe(3);
    expect(report.indexed).toBe(3);
    expect(progress).toHaveLength(3);
    expect(progress).not.toContain('notes.txt');
    expect([...indexer.indexedFiles()].sort()).toEqual(['src/casse.mjs', 'src/lib.mjs', 'src/service.mjs']);
  });

  it('peuple le graphe de dépendances avec les imports relatifs résolus', async () => {
    const { indexer, dependencyGraph } = buildIndexer({ files: PROJECT_FILES, directories: PROJECT_DIRECTORIES });
    await indexer.fullIndex();
    expect(dependencyGraph.directDependencies('src/service.mjs')).toEqual(['src/lib.mjs']);
    expect(dependencyGraph.dependents('src/lib.mjs')).toEqual(['src/service.mjs']);
  });

  it('relie le call-graph inter-fichiers (servir → aide exportée ailleurs)', async () => {
    const { indexer, symbolIndex, callGraph } = buildIndexer({ files: PROJECT_FILES, directories: PROJECT_DIRECTORIES });
    await indexer.fullIndex();
    const aide = symbolIndex.byName('aide', { exact: true })[0];
    const callers = callGraph.callers(aide.id, 1).map((chain) => chain[0]);
    const servir = symbolIndex.byName('servir', { exact: true })[0];
    expect(callers).toContain(servir.id);
    expect(indexer.findUsages(aide.id)[0].caller.name).toBe('servir');
  });

  it('rapporte les erreurs de parse sans casser l\'indexation', async () => {
    const { indexer } = buildIndexer({ files: PROJECT_FILES, directories: PROJECT_DIRECTORIES });
    const report = await indexer.fullIndex();
    expect(report.errors.some((entry) => entry.file === 'src/casse.mjs' && /ast_parse_failed/u.test(entry.error))).toBe(true);
  });

  it('incrementalIndex saute les fichiers au hash inchangé', async () => {
    const files = { ...PROJECT_FILES };
    const { indexer } = buildIndexer({ files, directories: PROJECT_DIRECTORIES });
    await indexer.fullIndex();
    const unchanged = await indexer.incrementalIndex({ changedFiles: ['src/lib.mjs'] });
    expect(unchanged.indexed).toBe(0);
    expect(unchanged.skipped).toBe(1);

    files[`${ROOT}/src/lib.mjs`] = 'export function aide() { return 2; }';
    const changed = await indexer.incrementalIndex({ changedFiles: ['src/lib.mjs'] });
    expect(changed.indexed).toBe(1);
    await expect(indexer.incrementalIndex({})).rejects.toThrow(/changed_files_required/u);
  });

  it('impactAnalysis remonte les fichiers affectés avec niveau de risque', async () => {
    const { indexer } = buildIndexer({ files: PROJECT_FILES, directories: PROJECT_DIRECTORIES });
    await indexer.fullIndex();
    const impact = indexer.impactAnalysis('src/lib.mjs');
    expect(impact.affectedFiles).toEqual(['src/service.mjs']);
    expect(impact.riskLevel).toBe('moyen');
    expect(indexer.impactAnalysis('src/service.mjs').riskLevel).toBe('faible');
  });

  it('status expose les compteurs et la date de dernière indexation', async () => {
    const { indexer } = buildIndexer({ files: PROJECT_FILES, directories: PROJECT_DIRECTORIES });
    expect(indexer.status().lastIndexedAt).toBeNull();
    await indexer.fullIndex();
    const status = indexer.status();
    expect(status.indexedFiles).toBe(3);
    expect(status.totalFiles).toBe(3);
    expect(status.lastIndexedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it('vector store optionnel : upsert appelé, panne silencieuse', async () => {
    const upserts = [];
    const okStore = { upsert: async (entry) => upserts.push(entry.id) };
    const { indexer } = buildIndexer({ files: PROJECT_FILES, directories: PROJECT_DIRECTORIES, vectorStore: okStore });
    await indexer.fullIndex();
    expect(upserts.length).toBeGreaterThan(0);

    const brokenStore = { upsert: async () => { throw new Error('down'); } };
    const { indexer: indexer2 } = buildIndexer({ files: PROJECT_FILES, directories: PROJECT_DIRECTORIES, vectorStore: brokenStore });
    await expect(indexer2.fullIndex()).resolves.toBeTruthy();
  });

  it('fileContent expose la source indexée', async () => {
    const { indexer } = buildIndexer({ files: PROJECT_FILES, directories: PROJECT_DIRECTORIES });
    await indexer.fullIndex();
    expect(indexer.fileContent('src/lib.mjs')).toContain('function aide');
    expect(indexer.fileContent('inconnu.mjs')).toBeNull();
  });
});
