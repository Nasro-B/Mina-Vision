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

// Frameworks Node : on exécute l'entrée JS LOCALE de l'outil via le binaire Node courant, PAS
// `npx`. Raison prouvée le 2026-07-24 : depuis Electron sur Windows, `execFile('npx', …)` échoue
// (ENOENT — npx n'est pas un .exe) et `npx.cmd` échoue aussi (EINVAL — spawn d'un .cmd bloqué
// par le correctif CVE-2024-27980), sans shell. Résultat : lanceur en échec, 0 vert. L'entrée JS
// + Node fonctionne partout, sans shell.
const NODE_TOOL_ENTRIES = Object.freeze({
  vitest: ['node_modules/vitest/vitest.mjs', 'run'],
  jest: ['node_modules/jest/bin/jest.js'],
  mocha: ['node_modules/mocha/bin/mocha.js'],
});
const NATIVE_COMMANDS = Object.freeze({
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
  // Binaire Node/Electron courant. Sous Electron, ELECTRON_RUN_AS_NODE=1 le fait agir en Node ;
  // sous Node pur (tests, CI), la variable est simplement ignorée — un seul chemin, partout.
  nodeBin = process.execPath,
} = {}) {
  if (!runCommand || typeof runCommand.run !== 'function') throw new TypeError('test_runner_runner_required');
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) throw new TypeError('test_runner_root_required');

  function commandFor(framework, extra) {
    const nodeEntry = NODE_TOOL_ENTRIES[framework];
    if (nodeEntry) {
      return {
        command: nodeBin,
        args: [...nodeEntry, ...extra],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      };
    }
    const [command, args] = NATIVE_COMMANDS[framework](extra);
    return { command, args, env: undefined };
  }

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
    const { command, args, env } = commandFor(framework, extraArgs);
    const result = await runCommand.run(command, args, { cwd: projectRoot, timeout, env });
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
      // Même raison qu'en batch : Node + entrée locale, jamais `npx` (échoue depuis Electron/Windows).
      const child = spawnImpl(nodeBin, ['node_modules/vitest/vitest.mjs', '--watch'], {
        cwd: projectRoot,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
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
