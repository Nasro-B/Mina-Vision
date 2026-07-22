import { describe, expect, it } from 'vitest';
import { createAstParser } from '../../src/code/intelligence/ast-parser.mjs';
import { createCallGraph } from '../../src/code/intelligence/call-graph.mjs';
import { createCodeSemanticSearch } from '../../src/code/intelligence/code-semantic-search.mjs';
import { createSymbolIndex } from '../../src/code/intelligence/symbol-index.mjs';

const parser = createAstParser();

function buildIndex(files) {
  const symbolIndex = createSymbolIndex();
  const contents = new Map();
  for (const [path, source] of Object.entries(files)) {
    symbolIndex.addFile(path, parser.parseFile(source, { filePath: path }));
    contents.set(path, source);
  }
  return { symbolIndex, fileContent: (path) => contents.get(path) ?? null };
}

const FILES = {
  'src/auth/jwt.mjs': 'export function validerJwt(token) { return token; }\nexport function inutilisee() { return 0; }',
  'src/routes/login.mjs': "import { validerJwt } from '../auth/jwt.mjs';\nexport function login(req) { return validerJwt(req.token); }",
  'tests/jwt.test.mjs': "import { validerJwt } from '../src/auth/jwt.mjs';\nvaliderJwt('x');",
  'src/util/logger.mjs': 'export function journaliser(message) { return message; }',
};

describe('code-semantic-search', () => {
  it('exige l\'index de symboles et une requête non vide', async () => {
    expect(() => createCodeSemanticSearch({})).toThrow(/symbol_index_required/u);
    const { symbolIndex, fileContent } = buildIndex(FILES);
    const search = createCodeSemanticSearch({ symbolIndex, fileContent });
    await expect(search.search('   ')).rejects.toThrow(/query_required/u);
  });

  it('recherche lexicale : le nom exact score plus haut que la mention en contenu', async () => {
    const { symbolIndex, fileContent } = buildIndex(FILES);
    const search = createCodeSemanticSearch({ symbolIndex, fileContent });
    const results = await search.search('validerJwt');
    expect(results[0].symbol.name).toBe('validerJwt');
    expect(results[0].source).toBe('lexicale');
  });

  it('recherche multi-termes avec filtre de fichier et maxResults', async () => {
    const { symbolIndex, fileContent } = buildIndex(FILES);
    const search = createCodeSemanticSearch({ symbolIndex, fileContent });
    const results = await search.search('jwt token', { fileFilter: 'src/', maxResults: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
    expect(results.every((entry) => entry.file.startsWith('src/'))).toBe(true);
  });

  it('vector store prioritaire quand il répond, repli lexical quand il tombe', async () => {
    const { symbolIndex, fileContent } = buildIndex(FILES);
    const jwt = symbolIndex.byName('validerJwt', { exact: true })[0];
    const vectorStore = { search: async () => [{ id: jwt.id, score: 0.93, metadata: { file: jwt.file } }] };
    const search = createCodeSemanticSearch({ symbolIndex, fileContent, vectorStore });
    const hits = await search.search('validation de jeton');
    expect(hits[0].source).toBe('vectorielle');
    expect(hits[0].symbol.name).toBe('validerJwt');

    const broken = createCodeSemanticSearch({
      symbolIndex,
      fileContent,
      vectorStore: { search: async () => { throw new Error('down'); } },
    });
    const fallback = await broken.search('validerJwt');
    expect(fallback[0].source).toBe('lexicale');
  });

  it('findSymbol filtre par kind et fichier', () => {
    const { symbolIndex, fileContent } = buildIndex(FILES);
    const search = createCodeSemanticSearch({ symbolIndex, fileContent });
    expect(search.findSymbol('validerJwt', { kind: 'function' })).toHaveLength(1);
    expect(search.findSymbol('validerJwt', { file: 'auth' })).toHaveLength(1);
    expect(search.findSymbol('validerJwt', { file: 'routes' })).toHaveLength(0);
  });

  it('findPattern retourne fichier, ligne, contexte — et rejette un motif invalide', () => {
    const { symbolIndex, fileContent } = buildIndex(FILES);
    const search = createCodeSemanticSearch({ symbolIndex, fileContent });
    const matches = search.findPattern('validerJwt\\(');
    expect(matches.some((entry) => entry.file === 'src/routes/login.mjs' && entry.line === 2)).toBe(true);
    expect(matches[0].context.length).toBeGreaterThan(0);
    expect(() => search.findPattern('([')).toThrow(/pattern_invalid/u);
  });

  it('findAllCalls localise tous les sites d\'appel', () => {
    const { symbolIndex, fileContent } = buildIndex(FILES);
    const search = createCodeSemanticSearch({ symbolIndex, fileContent });
    const calls = search.findAllCalls('validerJwt');
    expect(calls.map((entry) => entry.file).sort()).toEqual(['src/routes/login.mjs', 'tests/jwt.test.mjs']);
  });

  it('findUntestedFiles repère les sources sans test correspondant', () => {
    const { symbolIndex, fileContent } = buildIndex(FILES);
    const search = createCodeSemanticSearch({ symbolIndex, fileContent });
    const untested = search.findUntestedFiles();
    expect(untested).toContain('src/util/logger.mjs');
    expect(untested).not.toContain('src/auth/jwt.mjs');
    expect(untested).not.toContain('tests/jwt.test.mjs');
  });

  it('findDeadCode repère un export jamais importé ni appelé', () => {
    const { symbolIndex, fileContent } = buildIndex(FILES);
    const callGraph = createCallGraph();
    const search = createCodeSemanticSearch({ symbolIndex, fileContent, callGraph });
    const dead = search.findDeadCode();
    const names = dead.map((entry) => entry.symbol.name);
    expect(names).toContain('inutilisee');
    expect(names).not.toContain('validerJwt');
  });
});
