// Lanceur de tests : détecte le framework du projet cible (vitest/jest/mocha/pytest/go/cargo),
// exécute via le command-runner injecté (jamais de shell) et parse la sortie en TestResult.

import { parseTestOutput } from './test-parser.mjs';

const FRAMEWORK_RULES = Object.freeze([
  { name: 'vitest', test: ({ deps }) => 'vitest' in deps },
  { name: 'jest', test: ({ deps }) => 'jest' in deps },
  { name: 'mocha', test: ({ deps }) => 'mocha' in deps },
  { name: 'pytest', test: ({ tree }) => tree.some((entry) => entry === 'pytest.ini' || entry === 'conftest.py') },
  { name: 'go test', test: ({ tree }) => tree.includes('go.mod') },
  { name: 'cargo test', test: ({ tree }) => tree.includes('Cargo.toml') },
]);

const COMMANDS = Object.freeze({
  vitest: (extra) => ['npx', ['vitest', 'run', ...extra]],
  jest: (extra) => ['npx', ['jest', ...extra]],
  mocha: (extra) => ['npx', ['mocha', ...extra]],
  pytest: (extra) => ['python', ['-m', 'pytest', ...extra]],
  'go test': (extra) => ['go', ['test', './...', ...extra]],
  'cargo test': (extra) => ['cargo', ['test', ...extra]],
});

export function createTestRunner({
  runCommand,
  projectRoot,
  projectContext = null,
  spawnImpl = null,
  sandboxRunner = null,
} = {}) {
  if (!runCommand || typeof runCommand.run !== 'function') throw new TypeError('test_runner_runner_required');
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) throw new TypeError('test_runner_root_required');

  function detectFramework() {
    const deps = projectContext?.dependencies ?? {};
    const tree = projectContext?.tree ?? [];
    for (const rule of FRAMEWORK_RULES) {
      try {
        if (rule.test({ deps, tree })) return rule.name;
      } catch {
        // détection fail-soft
      }
    }
    return null;
  }

  async function execute(extraArgs, { timeout = 60_000 } = {}) {
    const framework = detectFramework();
    if (!framework) {
      return Object.freeze({ framework: null, parsed: false, passed: 0, failed: 0, skipped: 0, total: 0, reason: 'test_framework_unknown', failures: Object.freeze([]) });
    }
    const [command, args] = COMMANDS[framework](extraArgs);
    const result = await runCommand.run(command, args, { cwd: projectRoot, timeout });
    const combined = `${result.stdout}\n${result.stderr}`;
    const parsed = parseTestOutput(combined, { framework: framework.split(' ')[0] });
    return Object.freeze({
      ...parsed,
      framework,
      exitCode: result.code,
      timedOut: result.timedOut === true,
      // Un code non nul sans résumé parsé = crash du lanceur, pas un simple test rouge.
      crashed: result.code !== 0 && !parsed.parsed,
      output: combined.slice(-8_000),
    });
  }

  return Object.freeze({
    detectFramework,

    runAll: ({ timeout = 60_000, bail = false } = {}) => execute(bail ? ['--bail=1'] : [], { timeout }),

    runFile(filePath, { timeout = 60_000 } = {}) {
      if (typeof filePath !== 'string' || filePath.length === 0) {
        return Promise.reject(new Error('test_runner_file_required'));
      }
      return execute([filePath], { timeout });
    },

    runChanged: ({ timeout = 60_000 } = {}) => execute(['--changed'], { timeout }),

    // Mode veille : spawn streaming injecté. Sans spawnImpl → erreur nominée honnête.
    watch({ onChange } = {}) {
      if (typeof onChange !== 'function') throw new Error('test_runner_on_change_required');
      if (typeof spawnImpl !== 'function') throw new Error('test_runner_watch_unavailable');
      const framework = detectFramework();
      if (framework !== 'vitest') throw new Error(`test_runner_watch_unsupported: ${framework ?? 'aucun framework'}`);
      const child = spawnImpl('npx', ['vitest', '--watch'], { cwd: projectRoot });
      let buffer = '';
      child.stdout?.on?.('data', (chunk) => {
        buffer += String(chunk);
        const parsed = parseTestOutput(buffer, { framework: 'vitest' });
        if (parsed.parsed) {
          onChange(parsed);
          buffer = '';
        }
      });
      return Object.freeze({ stop: () => child.kill?.() });
    },

    async runInSandbox({ testFiles, timeout } = {}) {
      if (!sandboxRunner || typeof sandboxRunner.run !== 'function') {
        return Object.freeze({ status: 'sandbox_unavailable', reason: 'sandbox_runner_missing' });
      }
      return sandboxRunner.run({ testFiles, timeout });
    },
  });
}
