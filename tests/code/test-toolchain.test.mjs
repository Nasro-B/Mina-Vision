import { describe, expect, it } from 'vitest';
import { parseTestOutput } from '../../src/code/testing/test-parser.mjs';
import { createTestRunner } from '../../src/code/testing/test-runner.mjs';
import { createCoverageAnalyzer } from '../../src/code/testing/coverage-analyzer.mjs';

const VITEST_GREEN = `
 RUN  v4.1.10 C:/projets/demo

 Test Files  17 passed (17)
      Tests  220 passed (220)
   Start at  22:50:20
   Duration  2.80s (transform 1.18s, setup 0ms, import 2.28s, tests 458ms, environment 4ms)
`;

const VITEST_RED = `
 FAIL  tests/code/diff-engine.test.mjs > compte ajouts
 Test Files  1 failed | 16 passed (17)
      Tests  1 failed | 219 passed (220)
   Duration  3.07s
`;

describe('test-parser', () => {
  it('parse un résumé vitest vert : compteurs, fichiers, durée en ms', () => {
    const result = parseTestOutput(VITEST_GREEN, { framework: 'vitest' });
    expect(result).toMatchObject({ parsed: true, passed: 220, failed: 0, total: 220 });
    expect(result.files).toEqual({ failed: 0, passed: 17, total: 17 });
    expect(result.duration).toBe(2_800);
  });

  it('parse un résumé vitest rouge avec fichiers en échec', () => {
    const result = parseTestOutput(VITEST_RED, { framework: 'vitest' });
    expect(result).toMatchObject({ passed: 219, failed: 1, total: 220 });
    expect(result.failures[0]).toContain('tests/code/diff-engine.test.mjs');
  });

  it('parse vitest avec skipped', () => {
    const result = parseTestOutput('Tests  2 failed | 10 passed | 3 skipped (15)', { framework: 'vitest' });
    expect(result).toMatchObject({ failed: 2, passed: 10, skipped: 3, total: 15 });
  });

  it('parse jest et mocha', () => {
    expect(parseTestOutput('Tests:       2 failed, 40 passed, 42 total', { framework: 'jest' }))
      .toMatchObject({ parsed: true, failed: 2, passed: 40, total: 42 });
    expect(parseTestOutput('  12 passing (340ms)\n  1 failing', { framework: 'mocha' }))
      .toMatchObject({ parsed: true, passed: 12, failed: 1, total: 13 });
  });

  it('sortie inconnue → parsed false avec raison, jamais d\'exception', () => {
    const result = parseTestOutput('gibberish', { framework: 'vitest' });
    expect(result.parsed).toBe(false);
    expect(result.reason).toBe('test_output_unrecognized');
  });
});

function createFakeRunner(result) {
  const calls = [];
  return {
    calls,
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      return typeof result === 'function' ? result({ command, args }) : result;
    },
  };
}

describe('test-runner', () => {
  const vitestContext = { dependencies: { vitest: '4.0.0' }, tree: [] };

  it('détecte le framework depuis dépendances et arborescence', () => {
    const runner = createFakeRunner({ code: 0, stdout: '', stderr: '' });
    expect(createTestRunner({ runCommand: runner, projectRoot: 'C:/p', projectContext: vitestContext }).detectFramework()).toBe('vitest');
    expect(createTestRunner({ runCommand: runner, projectRoot: 'C:/p', projectContext: { dependencies: { jest: '29' }, tree: [] } }).detectFramework()).toBe('jest');
    expect(createTestRunner({ runCommand: runner, projectRoot: 'C:/p', projectContext: { dependencies: {}, tree: ['go.mod'] } }).detectFramework()).toBe('go test');
    expect(createTestRunner({ runCommand: runner, projectRoot: 'C:/p', projectContext: { dependencies: {}, tree: [] } }).detectFramework()).toBeNull();
  });

  it('runAll lance vitest via Node (pas npx — échoue depuis Electron/Windows) et parse', async () => {
    const runner = createFakeRunner({ code: 0, stdout: VITEST_GREEN, stderr: '' });
    const testRunner = createTestRunner({ runCommand: runner, projectRoot: 'C:/p', projectContext: vitestContext, nodeBin: 'node' });
    const result = await testRunner.runAll();
    // Binaire Node courant + entrée JS locale de vitest — jamais `npx` (execFile ne peut pas lancer npx.cmd).
    expect(runner.calls[0].command).toBe('node');
    expect(runner.calls[0].args).toEqual(['node_modules/vitest/vitest.mjs', 'run']);
    // ELECTRON_RUN_AS_NODE transmis pour qu'Electron agisse en Node.
    expect(runner.calls[0].options.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(result).toMatchObject({ passed: 220, failed: 0, crashed: false, framework: 'vitest' });
  });

  it('bail et runFile passent les bons arguments', async () => {
    const runner = createFakeRunner({ code: 0, stdout: VITEST_GREEN, stderr: '' });
    const testRunner = createTestRunner({ runCommand: runner, projectRoot: 'C:/p', projectContext: vitestContext, nodeBin: 'node' });
    await testRunner.runAll({ bail: true });
    expect(runner.calls[0].args).toEqual(['node_modules/vitest/vitest.mjs', 'run', '--bail=1']);
    await testRunner.runFile('tests/a.test.mjs');
    expect(runner.calls[1].args).toEqual(['node_modules/vitest/vitest.mjs', 'run', 'tests/a.test.mjs']);
    await expect(testRunner.runFile('')).rejects.toThrow(/file_required/u);
  });

  it('crash du lanceur (code ≠ 0 sans résumé) → crashed true', async () => {
    const runner = createFakeRunner({ code: 1, stdout: '', stderr: 'Cannot find module' });
    const testRunner = createTestRunner({ runCommand: runner, projectRoot: 'C:/p', projectContext: vitestContext });
    const result = await testRunner.runAll();
    expect(result.crashed).toBe(true);
    expect(result.parsed).toBe(false);
  });

  it('aucun framework → résultat nominé sans exécution', async () => {
    const runner = createFakeRunner({ code: 0, stdout: '', stderr: '' });
    const testRunner = createTestRunner({ runCommand: runner, projectRoot: 'C:/p', projectContext: { dependencies: {}, tree: [] } });
    const result = await testRunner.runAll();
    expect(result.reason).toBe('test_framework_unknown');
    expect(runner.calls).toHaveLength(0);
  });

  it('watch : refuse sans spawn injecté, stream et parse avec', () => {
    const runner = createFakeRunner({ code: 0, stdout: '', stderr: '' });
    const noSpawn = createTestRunner({ runCommand: runner, projectRoot: 'C:/p', projectContext: vitestContext });
    expect(() => noSpawn.watch({ onChange: () => {} })).toThrow(/watch_unavailable/u);
    expect(() => noSpawn.watch({})).toThrow(/on_change_required/u);

    const listeners = {};
    let killed = false;
    const spawnImpl = () => ({
      stdout: { on: (event, callback) => { listeners[event] = callback; } },
      kill: () => { killed = true; },
    });
    const withSpawn = createTestRunner({ runCommand: runner, projectRoot: 'C:/p', projectContext: vitestContext, spawnImpl });
    const seen = [];
    const handle = withSpawn.watch({ onChange: (parsed) => seen.push(parsed) });
    listeners.data('Tests  5 passed (5)\n');
    expect(seen[0]).toMatchObject({ passed: 5 });
    handle.stop();
    expect(killed).toBe(true);
  });

  it('runInSandbox délègue ou répond sandbox_unavailable', async () => {
    const runner = createFakeRunner({ code: 0, stdout: '', stderr: '' });
    const without = createTestRunner({ runCommand: runner, projectRoot: 'C:/p', projectContext: vitestContext });
    expect((await without.runInSandbox({})).status).toBe('sandbox_unavailable');
    const withSandbox = createTestRunner({
      runCommand: runner,
      projectRoot: 'C:/p',
      projectContext: vitestContext,
      sandboxRunner: { run: async () => ({ status: 'completed', passed: 3 }) },
    });
    expect((await withSandbox.runInSandbox({})).status).toBe('completed');
  });
});

describe('coverage-analyzer', () => {
  const SUMMARY = JSON.stringify({
    total: { lines: { pct: 85.5 }, branches: { pct: 78 }, functions: { pct: 90 }, statements: { pct: 85 } },
    'C:/p/src/couvert.mjs': { lines: { pct: 95 }, branches: { pct: 90 }, functions: { pct: 100 }, statements: { pct: 95 } },
    'C:/p/src/faible.mjs': { lines: { pct: 40 }, branches: { pct: 30 }, functions: { pct: 50 }, statements: { pct: 40 } },
    'C:/p/src/zero.mjs': { lines: { pct: 0 }, branches: { pct: 0 }, functions: { pct: 0 }, statements: { pct: 0 } },
  });

  const fsWith = (content) => ({
    readFile: async (path) => {
      if (content === null) throw new Error('ENOENT');
      expect(path).toContain('coverage/coverage-summary.json');
      return content;
    },
  });

  it('rapport absent → coverage_report_missing, jamais d\'exception', async () => {
    const analyzer = createCoverageAnalyzer({ fs: fsWith(null), projectRoot: 'C:/p' });
    const report = await analyzer.report();
    expect(report.available).toBe(false);
    expect(report.reason).toMatch(/coverage_report_missing/u);
  });

  it('rapport parsé : totaux, seuil, fichiers sous le seuil (chemins relatifs)', async () => {
    const analyzer = createCoverageAnalyzer({ fs: fsWith(SUMMARY), projectRoot: 'C:/p' });
    const report = await analyzer.report({ threshold: 80 });
    expect(report.total.lines).toBe(85.5);
    expect(report.meetsThreshold).toBe(true);
    expect(report.files).toHaveLength(3);
    expect(report.belowThreshold.map((entry) => entry.file).sort()).toEqual(['src/faible.mjs', 'src/zero.mjs']);
  });

  it('findUncovered ne retourne que les fichiers à 0 %', async () => {
    const analyzer = createCoverageAnalyzer({ fs: fsWith(SUMMARY), projectRoot: 'C:/p' });
    const uncovered = await analyzer.findUncovered();
    expect(uncovered.map((entry) => entry.file)).toEqual(['src/zero.mjs']);
  });

  it('JSON corrompu → indisponible proprement', async () => {
    const analyzer = createCoverageAnalyzer({ fs: fsWith('{cassé'), projectRoot: 'C:/p' });
    expect((await analyzer.report()).available).toBe(false);
  });
});
