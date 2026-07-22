// Formateur de code : délègue à Prettier UNIQUEMENT si le projet cible l'utilise déjà (config ou
// dépendance présente). Jamais de reformatage imposé à un projet qui n'en veut pas — fail-soft
// « formatter_unavailable » sinon. Seuls les fichiers explicitement passés sont formatés.

export function createCodeFormatter({ runCommand, projectRoot, projectContext = null } = {}) {
  if (!runCommand || typeof runCommand.run !== 'function') throw new TypeError('code_formatter_runner_required');
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) throw new TypeError('code_formatter_root_required');

  const prettierAvailable = () => Boolean(
    projectContext?.prettierConfig
    || (projectContext?.dependencies && 'prettier' in projectContext.dependencies),
  );

  return Object.freeze({
    isAvailable: prettierAvailable,

    async format({ files, check = false } = {}) {
      if (!Array.isArray(files) || files.length === 0) throw new Error('code_formatter_files_required');
      if (!prettierAvailable()) {
        return Object.freeze({ formatted: Object.freeze([]), skipped: Object.freeze([...files]), reason: 'formatter_unavailable' });
      }
      const args = ['prettier', check ? '--check' : '--write', ...files];
      const result = await runCommand.run('npx', args, { cwd: projectRoot, timeout: 60_000 });
      if (result.code !== 0 && !check) {
        return Object.freeze({
          formatted: Object.freeze([]),
          skipped: Object.freeze([...files]),
          reason: `formatter_failed: ${(result.stderr || result.stdout).slice(0, 500)}`,
        });
      }
      return Object.freeze({
        formatted: Object.freeze(check ? [] : [...files]),
        skipped: Object.freeze([]),
        check: check ? Object.freeze({ clean: result.code === 0, output: result.stdout.slice(0, 2_000) }) : undefined,
        reason: null,
      });
    },
  });
}
