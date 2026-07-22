// Lanceur de lint : ESLint si le projet cible en a un (config présente), sortie JSON parsée en
// findings normalisés. Fail-soft « lint_unavailable » si absent — jamais bloquant.

export function createLintRunner({ runCommand, projectRoot, projectContext = null } = {}) {
  if (!runCommand || typeof runCommand.run !== 'function') throw new TypeError('lint_runner_runner_required');
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) throw new TypeError('lint_runner_root_required');

  const eslintAvailable = () => Boolean(
    projectContext?.eslintConfig
    || (projectContext?.dependencies && 'eslint' in projectContext.dependencies),
  );

  return Object.freeze({
    isAvailable: eslintAvailable,

    async lint({ files } = {}) {
      if (!Array.isArray(files) || files.length === 0) throw new Error('lint_runner_files_required');
      if (!eslintAvailable()) {
        return Object.freeze({ available: false, reason: 'lint_unavailable', findings: Object.freeze([]) });
      }
      const result = await runCommand.run('npx', ['eslint', '--format', 'json', ...files], {
        cwd: projectRoot,
        timeout: 120_000,
      });
      let reports;
      try {
        reports = JSON.parse(result.stdout || '[]');
      } catch {
        return Object.freeze({
          available: true,
          reason: `lint_output_invalid: ${(result.stderr || result.stdout).slice(0, 500)}`,
          findings: Object.freeze([]),
        });
      }
      const findings = [];
      for (const report of reports) {
        for (const message of report.messages ?? []) {
          findings.push(Object.freeze({
            file: report.filePath,
            line: message.line ?? 0,
            column: message.column ?? 0,
            severity: message.severity === 2 ? 'error' : 'warning',
            rule: message.ruleId ?? 'inconnu',
            message: message.message ?? '',
          }));
        }
      }
      return Object.freeze({
        available: true,
        reason: null,
        clean: findings.every((finding) => finding.severity !== 'error'),
        findings: Object.freeze(findings),
      });
    },
  });
}
