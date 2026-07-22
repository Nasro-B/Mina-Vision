import { describe, expect, it } from 'vitest';
import { createCodeFormatter } from '../../src/code/editing/code-formatter.mjs';
import { createLintRunner } from '../../src/code/editing/lint-runner.mjs';
import { createCommandRunner } from '../../src/code/run-command.mjs';

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

describe('command-runner', () => {
  it('exécute via execFile injecté sans shell et retourne code/stdout/stderr', async () => {
    const seen = [];
    const runner = createCommandRunner({
      execFileImpl: (command, args, options, callback) => {
        seen.push({ command, args, options });
        callback(null, 'sortie', '');
      },
    });
    const result = await runner.run('git', ['status'], { cwd: 'C:/x', timeout: 5_000 });
    expect(result).toMatchObject({ code: 0, stdout: 'sortie', timedOut: false });
    expect(seen[0].options.windowsHide).toBe(true);
    expect(seen[0].options.timeout).toBe(5_000);
  });

  it('code de sortie non nul et timeout signalés proprement', async () => {
    const failing = createCommandRunner({
      execFileImpl: (command, args, options, callback) => {
        callback(Object.assign(new Error('échec'), { code: 2, killed: false }), '', 'stderr');
      },
    });
    expect(await failing.run('git', ['boom'])).toMatchObject({ code: 2, stderr: 'stderr' });

    const timedOut = createCommandRunner({
      execFileImpl: (command, args, options, callback) => {
        callback(Object.assign(new Error('tué'), { killed: true }), '', '');
      },
    });
    expect((await timedOut.run('lent', [])).timedOut).toBe(true);
  });

  it('valide commande et arguments', async () => {
    const runner = createCommandRunner({ execFileImpl: () => {} });
    await expect(runner.run('')).rejects.toThrow(/command_required/u);
    await expect(runner.run('git', [1])).rejects.toThrow(/args_invalid/u);
  });
});

describe('code-formatter', () => {
  it('exige runner et racine', () => {
    expect(() => createCodeFormatter({})).toThrow(/runner_required/u);
    expect(() => createCodeFormatter({ runCommand: createFakeRunner({}) })).toThrow(/root_required/u);
  });

  it('fail-soft formatter_unavailable quand le projet n\'a pas Prettier', async () => {
    const runner = createFakeRunner({ code: 0, stdout: '', stderr: '' });
    const formatter = createCodeFormatter({ runCommand: runner, projectRoot: 'C:/p', projectContext: { dependencies: {} } });
    expect(formatter.isAvailable()).toBe(false);
    const result = await formatter.format({ files: ['a.mjs'] });
    expect(result.reason).toBe('formatter_unavailable');
    expect(runner.calls).toHaveLength(0);
  });

  it('formate SEULEMENT les fichiers passés quand Prettier est présent', async () => {
    const runner = createFakeRunner({ code: 0, stdout: '', stderr: '' });
    const formatter = createCodeFormatter({
      runCommand: runner,
      projectRoot: 'C:/p',
      projectContext: { dependencies: { prettier: '3.0.0' } },
    });
    const result = await formatter.format({ files: ['a.mjs', 'b.css'] });
    expect(result.formatted).toEqual(['a.mjs', 'b.css']);
    expect(runner.calls[0].args).toEqual(['prettier', '--write', 'a.mjs', 'b.css']);
    await expect(formatter.format({ files: [] })).rejects.toThrow(/files_required/u);
  });

  it('échec Prettier → raison nominée, jamais d\'exception', async () => {
    const runner = createFakeRunner({ code: 2, stdout: '', stderr: 'SyntaxError' });
    const formatter = createCodeFormatter({
      runCommand: runner,
      projectRoot: 'C:/p',
      projectContext: { prettierConfig: { file: '.prettierrc' } },
    });
    const result = await formatter.format({ files: ['a.mjs'] });
    expect(result.reason).toMatch(/formatter_failed: SyntaxError/u);
    expect(result.formatted).toEqual([]);
  });
});

describe('lint-runner', () => {
  const ESLINT_JSON = JSON.stringify([{
    filePath: 'C:/p/a.mjs',
    messages: [
      { line: 3, column: 5, severity: 2, ruleId: 'no-unused-vars', message: 'inutilisée' },
      { line: 8, column: 1, severity: 1, ruleId: 'complexity', message: 'trop complexe' },
    ],
  }]);

  it('fail-soft lint_unavailable sans ESLint', async () => {
    const runner = createFakeRunner({ code: 0, stdout: '[]', stderr: '' });
    const lint = createLintRunner({ runCommand: runner, projectRoot: 'C:/p', projectContext: {} });
    const result = await lint.lint({ files: ['a.mjs'] });
    expect(result).toMatchObject({ available: false, reason: 'lint_unavailable' });
    expect(runner.calls).toHaveLength(0);
  });

  it('parse la sortie JSON en findings normalisés error/warning', async () => {
    const runner = createFakeRunner({ code: 1, stdout: ESLINT_JSON, stderr: '' });
    const lint = createLintRunner({
      runCommand: runner,
      projectRoot: 'C:/p',
      projectContext: { eslintConfig: { file: 'eslint.config.mjs' } },
    });
    const result = await lint.lint({ files: ['a.mjs'] });
    expect(result.clean).toBe(false);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]).toMatchObject({ severity: 'error', rule: 'no-unused-vars', line: 3 });
    expect(result.findings[1].severity).toBe('warning');
    expect(runner.calls[0].args.slice(0, 3)).toEqual(['eslint', '--format', 'json']);
  });

  it('sortie non-JSON → raison nominée sans exception', async () => {
    const runner = createFakeRunner({ code: 2, stdout: 'crash', stderr: 'boom' });
    const lint = createLintRunner({
      runCommand: runner,
      projectRoot: 'C:/p',
      projectContext: { dependencies: { eslint: '9.0.0' } },
    });
    const result = await lint.lint({ files: ['a.mjs'] });
    expect(result.reason).toMatch(/lint_output_invalid/u);
    expect(result.findings).toEqual([]);
  });
});
