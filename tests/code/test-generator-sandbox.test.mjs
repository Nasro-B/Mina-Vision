import { describe, expect, it } from 'vitest';
import { createAstParser } from '../../src/code/intelligence/ast-parser.mjs';
import { createSymbolIndex } from '../../src/code/intelligence/symbol-index.mjs';
import { createTestGenerator } from '../../src/code/testing/test-generator.mjs';
import { createSandboxTestRunner } from '../../src/code/testing/sandbox-test-runner.mjs';

function buildIndex(files) {
  const parser = createAstParser();
  const symbolIndex = createSymbolIndex();
  const contents = new Map();
  for (const [path, source] of Object.entries(files)) {
    symbolIndex.addFile(path, parser.parseFile(source, { filePath: path }));
    contents.set(path, source);
  }
  return { symbolIndex, fileContent: (path) => contents.get(path) ?? null };
}

describe('test-generator', () => {
  const FILES = {
    'src/service.mjs': 'export function servir(commande, options) { return commande; }\nfunction interne() {}\nexport class Machine {}',
    'tests/existant.test.mjs': "import { describe, expect, it, vi } from 'vitest';\nvi.fn();",
  };

  it('exige l\'index et un symbole connu', () => {
    expect(() => createTestGenerator({})).toThrow(/symbol_index_required/u);
    const { symbolIndex, fileContent } = buildIndex(FILES);
    const generator = createTestGenerator({ symbolIndex, fileContent });
    expect(() => generator.generateForSymbol('inconnu')).toThrow(/symbol_unknown/u);
  });

  it('détecte le style de test réel du projet (vitest + vi)', () => {
    const { symbolIndex, fileContent } = buildIndex(FILES);
    const generator = createTestGenerator({ symbolIndex, fileContent });
    const style = generator.detectTestStyle();
    expect(style.framework).toBe('vitest');
    expect(style.usesVi).toBe(true);
    expect(style.imports).toContain('vi');
  });

  it('suggère des cas limites depuis la signature', () => {
    const { symbolIndex, fileContent } = buildIndex(FILES);
    const generator = createTestGenerator({ symbolIndex, fileContent });
    const servir = symbolIndex.byName('servir', { exact: true })[0];
    const cases = generator.suggestEdgeCases(servir.id);
    expect(cases.some((entry) => entry.label.includes('commande absent'))).toBe(true);
    expect(cases.some((entry) => entry.label.includes('chaîne vide'))).toBe(true);
  });

  it('génère un squelette honnête : imports corrects, TODO explicites, fichier tests/', () => {
    const { symbolIndex, fileContent } = buildIndex(FILES);
    const generator = createTestGenerator({ symbolIndex, fileContent });
    const servir = symbolIndex.byName('servir', { exact: true })[0];
    const generated = generator.generateForSymbol(servir.id);
    expect(generated.file).toBe('tests/code/service.test.mjs');
    expect(generated.content).toContain("from '../../src/service.mjs'");
    expect(generated.content).toContain("describe('servir'");
    expect(generated.content).toContain('TODO(Mina Code)');
    expect(generated.content).toContain('cas limite');
  });

  it('generateForFile ne couvre que les exports fonction/classe', () => {
    const { symbolIndex, fileContent } = buildIndex(FILES);
    const generator = createTestGenerator({ symbolIndex, fileContent });
    const generated = generator.generateForFile('src/service.mjs');
    const names = generated.map((entry) => entry.symbol);
    expect(names).toContain('servir');
    expect(names).toContain('Machine');
    expect(names).not.toContain('interne');
    expect(() => generator.generateForFile('inconnu.mjs')).toThrow(/file_unknown/u);
  });
});

describe('sandbox-test-runner', () => {
  it('sans backend → sandbox_unavailable, jamais d\'exception', async () => {
    const runner = createSandboxTestRunner({});
    expect((await runner.availability()).available).toBe(false);
    expect((await runner.run({})).status).toBe('sandbox_unavailable');
  });

  it('backend indisponible (probe rouge) → sandbox_unavailable avec la vraie raison', async () => {
    const runner = createSandboxTestRunner({
      sandboxBackend: {
        detect: async () => ({ available: false, reason: 'windows_sandbox_feature_disabled' }),
        execute: async () => { throw new Error('ne doit pas être appelé'); },
      },
    });
    const result = await runner.run({});
    expect(result).toMatchObject({ status: 'sandbox_unavailable', reason: 'windows_sandbox_feature_disabled' });
  });

  it('backend dispo mais SANS workspaceBuilder → sandbox_unavailable (réseau coupé = node_modules requis)', async () => {
    const runner = createSandboxTestRunner({
      sandboxBackend: { detect: async () => ({ available: true, reason: null }), execute: async () => ({}) },
    });
    const result = await runner.run({});
    expect(result).toMatchObject({ status: 'sandbox_unavailable', reason: 'sandbox_workspace_builder_missing' });
  });

  it('chemin nominal : prépare le workspace AVEC node_modules, exécute, lit et parse le résultat, nettoie', async () => {
    const events = [];
    const runner = createSandboxTestRunner({
      now: () => 1_234,
      sandboxBackend: {
        detect: async () => ({ available: true, reason: null }),
        execute: async ({ jobId, job, workspace }) => {
          events.push(['execute', jobId, job.limits.wallMs, workspace.outPath]);
        },
      },
      workspaceBuilder: {
        prepare: async ({ jobId, includeNodeModules }) => {
          events.push(['prepare', jobId, includeNodeModules]);
          return { sourcePath: 'S', outPath: 'O', bootstrapPath: 'B' };
        },
        cleanup: async ({ jobId }) => { events.push(['cleanup', jobId]); },
      },
      resultReader: { read: async () => 'Tests  8 passed (8)' },
    });
    const result = await runner.run({ testFiles: ['tests/a.test.mjs'], timeout: 60_000 });
    expect(result).toMatchObject({ status: 'completed', passed: 8, total: 8 });
    expect(events).toEqual([
      ['prepare', 'mina-tests-1234', true],
      ['execute', 'mina-tests-1234', 60_000, 'O'],
      ['cleanup', 'mina-tests-1234'],
    ]);
  });

  it('échec d\'exécution → sandbox_failed avec nettoyage quand même', async () => {
    const events = [];
    const runner = createSandboxTestRunner({
      sandboxBackend: {
        detect: async () => ({ available: true, reason: null }),
        execute: async () => { throw new Error('sandbox_wall_time_exceeded'); },
      },
      workspaceBuilder: {
        prepare: async () => ({ sourcePath: 'S', outPath: 'O', bootstrapPath: 'B' }),
        cleanup: async () => { events.push('cleanup'); },
      },
    });
    const result = await runner.run({});
    expect(result.status).toBe('sandbox_failed');
    expect(result.reason).toContain('sandbox_wall_time_exceeded');
    expect(events).toEqual(['cleanup']);
  });

  it('échec de préparation du workspace → sandbox_workspace_failed', async () => {
    const runner = createSandboxTestRunner({
      sandboxBackend: { detect: async () => ({ available: true, reason: null }), execute: async () => ({}) },
      workspaceBuilder: { prepare: async () => { throw new Error('copie node_modules impossible'); } },
    });
    const result = await runner.run({});
    expect(result).toMatchObject({ status: 'sandbox_workspace_failed' });
    expect(result.reason).toContain('node_modules');
  });
});
