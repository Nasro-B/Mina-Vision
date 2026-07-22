// Applicateur de patchs : orchestration stricte autour du diff-engine.
// Règles : backup avant édition, AST revalidé après édition (invalide → rollback), fichiers
// binaires refusés, dry-run sans effet, formatage/lint limités aux fichiers touchés.

const TEXT_EXTENSIONS = Object.freeze([
  '.mjs', '.cjs', '.js', '.json', '.md', '.css', '.html', '.txt', '.yml', '.yaml', '.toml', '.svg', '.ts', '.tsx', '.jsx',
]);
const JS_EXTENSIONS = Object.freeze(['.mjs', '.cjs', '.js']);

const isTextFile = (file) => TEXT_EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension));
const isJsFile = (file) => JS_EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension));

export function createPatchApplier({
  diffEngine,
  fileBackup,
  astParser = null,
  codeFormatter = null,
  lintRunner = null,
  fs,
} = {}) {
  if (!diffEngine) throw new TypeError('patch_applier_diff_engine_required');
  if (!fileBackup) throw new TypeError('patch_applier_backup_required');
  if (!fs || typeof fs.readFile !== 'function' || typeof fs.writeFile !== 'function') {
    throw new TypeError('patch_applier_fs_required');
  }

  return Object.freeze({
    async apply({ patches, reformat = true, lint = true, backup = true, dryRun = false } = {}) {
      if (typeof patches !== 'string' || patches.trim().length === 0) {
        throw new Error('patch_applier_patches_required');
      }
      const parsed = diffEngine.parseMinaPatch(patches);
      for (const entry of parsed) {
        if (!isTextFile(entry.file)) {
          throw new Error(`patch_applier_binary_refused: ${entry.file}`);
        }
      }

      if (dryRun) {
        const preview = [];
        for (const entry of parsed) {
          if (entry.operation === 'update') {
            const original = String(await fs.readFile(entry.file, 'utf8'));
            const next = diffEngine.applyHunksToContent(original, entry.hunks, entry.file);
            const summary = diffEngine.diff({ original, modified: next, filePath: entry.file });
            preview.push({ file: entry.file, operation: 'update', additions: summary.additions, deletions: summary.deletions });
          } else {
            preview.push({ file: entry.file, operation: entry.operation });
          }
        }
        return Object.freeze({ dryRun: true, applied: Object.freeze([]), preview: Object.freeze(preview.map((entry) => Object.freeze(entry))) });
      }

      const result = await diffEngine.applyPatch({ patch: patches, backup });
      const touched = result.applied.filter((entry) => entry.operation !== 'delete').map((entry) => entry.file);

      // Intégrité AST : chaque fichier JS modifié doit reparser — sinon rollback complet.
      if (astParser) {
        for (const file of touched.filter(isJsFile)) {
          const source = String(await fs.readFile(file, 'utf8'));
          const validation = astParser.validate(source);
          if (!validation.valid) {
            for (const entry of [...result.applied].reverse()) {
              if (entry.operation !== 'add' && fileBackup.hasBackup(entry.file)) {
                await fileBackup.restore(entry.file).catch(() => {});
              } else if (entry.operation === 'add') {
                await fs.rm(entry.file, { force: true }).catch(() => {});
              }
            }
            throw new Error(`patch_applier_ast_invalid: ${file} — ${validation.error}`);
          }
        }
      }

      let formatting = null;
      if (reformat && codeFormatter && touched.length > 0) {
        formatting = await codeFormatter.format({ files: touched }).catch((error) => ({ reason: `formatter_failed: ${error.message}` }));
      }
      let linting = null;
      if (lint && lintRunner && touched.length > 0) {
        linting = await lintRunner.lint({ files: touched }).catch((error) => ({ reason: `lint_failed: ${error.message}`, findings: [] }));
      }

      return Object.freeze({
        dryRun: false,
        applied: result.applied,
        formatting,
        linting,
      });
    },
  });
}
