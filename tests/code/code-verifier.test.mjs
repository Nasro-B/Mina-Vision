import { describe, expect, it } from 'vitest';
import { createAstParser } from '../../src/code/intelligence/ast-parser.mjs';
import { createDiffEngine } from '../../src/code/editing/diff-engine.mjs';
import { createSecurityScanner } from '../../src/code/review/security-scanner.mjs';
import { createCodeVerifier } from '../../src/code/code-verifier.mjs';

function createMemFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async (path) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path);
    },
  };
}

function buildVerifier(files, { testRunner = null } = {}) {
  return createCodeVerifier({
    astParser: createAstParser(),
    securityScanner: createSecurityScanner({ fileContent: () => null }),
    diffEngine: createDiffEngine(),
    testRunner,
    fs: createMemFs(files),
  });
}

describe('code-verifier', () => {
  it('exige parseur, scanner et fs', () => {
    expect(() => createCodeVerifier({})).toThrow(/ast_parser_required/u);
  });

  it('tout vert sur une édition propre', async () => {
    const verifier = buildVerifier({ 'src/app.mjs': 'export const version = 2;' });
    const result = await verifier.verify({
      files: ['src/app.mjs'],
      beforeState: { 'src/app.mjs': 'export const version = 1;' },
    });
    expect(result.ok).toBe(true);
    expect(result.checks.every((entry) => entry.ok)).toBe(true);
  });

  it('AST cassée → refus avec preuve', async () => {
    const verifier = buildVerifier({ 'src/app.mjs': 'function {' });
    const result = await verifier.verify({ files: ['src/app.mjs'] });
    expect(result.ok).toBe(false);
    expect(result.checks.find((entry) => entry.name === 'ast:src/app.mjs').detail).toMatch(/ast_parse_failed/u);
  });

  it('secret INTRODUIT refusé, secret préexistant toléré (pas de faux positif de legacy)', async () => {
    const secretLine = "const key = 'AIzaSyA1234567890abcdefghijklmnopqrstuv';";
    const introduced = buildVerifier({ 'config.mjs': secretLine });
    const bad = await introduced.verify({ files: ['config.mjs'], beforeState: { 'config.mjs': 'const key = null;' } });
    expect(bad.ok).toBe(false);
    expect(bad.checks.find((entry) => entry.name === 'secrets:config.mjs').ok).toBe(false);

    const preexisting = buildVerifier({ 'config.mjs': `${secretLine}\nexport const ok = 1;` });
    const tolerated = await preexisting.verify({
      files: ['config.mjs'],
      beforeState: { 'config.mjs': secretLine },
    });
    expect(tolerated.checks.find((entry) => entry.name === 'secrets:config.mjs').ok).toBe(true);
  });

  it('fichier protégé touché → refus', async () => {
    const verifier = buildVerifier({ '.env': 'API_KEY=x' });
    const result = await verifier.verify({ files: ['.env'] });
    expect(result.ok).toBe(false);
    expect(result.checks.find((entry) => entry.name === 'fichiers_protégés_intacts').detail).toContain('.env');
  });

  it('réécriture massive non déclarée → diff non minimal refusé', async () => {
    const before = Array.from({ length: 20 }, (_, index) => `const ligne${index} = ${index};`).join('\n');
    const after = Array.from({ length: 20 }, (_, index) => `let autre${index} = ${index + 1};`).join('\n');
    const verifier = buildVerifier({ 'src/gros.mjs': after });
    const result = await verifier.verify({ files: ['src/gros.mjs'], beforeState: { 'src/gros.mjs': before } });
    expect(result.checks.find((entry) => entry.name === 'diff_minimal:src/gros.mjs').ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('commande bloquée dans l\'action → refus immédiat', async () => {
    const verifier = buildVerifier({});
    const result = await verifier.verify({ action: { command: 'git push origin main' }, files: [] });
    expect(result.ok).toBe(false);
    expect(result.checks[0].detail).toContain('git push');
  });

  it('runTests : vert → ok, rouge → refus, runner absent → refus nominé', async () => {
    const green = buildVerifier({}, { testRunner: { runAll: async () => ({ passed: 10, failed: 0 }) } });
    expect((await green.verify({ files: [], runTests: true })).ok).toBe(true);

    const red = buildVerifier({}, { testRunner: { runAll: async () => ({ passed: 8, failed: 2 }) } });
    const redResult = await red.verify({ files: [], runTests: true });
    expect(redResult.ok).toBe(false);
    expect(redResult.checks.find((entry) => entry.name === 'tests').detail).toContain('2 rouges');

    const missing = buildVerifier({});
    expect((await missing.verify({ files: [], runTests: true })).checks.find((entry) => entry.name === 'tests').detail)
      .toBe('test_runner_indisponible');
  });

  it('fichier illisible après édition → refus', async () => {
    const verifier = buildVerifier({});
    const result = await verifier.verify({ files: ['disparu.mjs'] });
    expect(result.ok).toBe(false);
    expect(result.checks.find((entry) => entry.name === 'lecture:disparu.mjs').ok).toBe(false);
  });
});
