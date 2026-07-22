// Vérificateur post-action du domaine code : une édition n'est déclarée réussie qu'après
// PREUVE. Six contrôles (spec §10.2), fail-closed : un seul rouge → verdict négatif.
//   1. Intégrité AST des fichiers JS modifiés
//   2. Aucun secret introduit
//   3. Aucun fichier protégé touché
//   4. Diff minimal (pas de réécriture massive non déclarée)
//   5. Aucune commande bloquée dans l'action
//   6. Tests verts (optionnel, si runTests demandé)

import { isProtectedPath, matchBlockedCommand } from './code-safety-policy.mjs';

const MASSIVE_REWRITE_RATIO = 0.6;
// En dessous de ce volume de lignes changées, jamais de grief « réécriture massive » :
// un petit fichier édité en entier reste un diff minimal.
const MASSIVE_REWRITE_MIN_CHANGED_LINES = 30;

export function createCodeVerifier({ astParser, securityScanner, testRunner = null, diffEngine = null, fs } = {}) {
  if (!astParser) throw new TypeError('code_verifier_ast_parser_required');
  if (!securityScanner || typeof securityScanner.scanText !== 'function') {
    throw new TypeError('code_verifier_security_scanner_required');
  }
  if (!fs || typeof fs.readFile !== 'function') throw new TypeError('code_verifier_fs_required');

  const isJs = (file) => /\.(?:mjs|cjs|js)$/u.test(String(file));

  return Object.freeze({
    async verify({ action = null, files = [], beforeState = {}, runTests = false } = {}) {
      const checks = [];
      const check = (name, ok, detail) => checks.push(Object.freeze({ name, ok, detail }));

      // 5. Commande bloquée — vérifiée d'abord (le moins cher, le plus grave).
      if (action?.command !== undefined) {
        const blocked = matchBlockedCommand(action.command);
        check('commande_autorisée', blocked === null, blocked ? `commande bloquée : ${blocked}` : 'aucune commande bloquée');
      } else {
        check('commande_autorisée', true, 'aucune commande dans l\'action');
      }

      // 3. Fichiers protégés.
      const protectedTouched = files.filter((file) => isProtectedPath(file));
      check('fichiers_protégés_intacts', protectedTouched.length === 0,
        protectedTouched.length > 0 ? `fichier protégé touché : ${protectedTouched.join(', ')}` : 'aucun fichier protégé touché');

      for (const file of files) {
        let content = null;
        try {
          content = String(await fs.readFile(file, 'utf8'));
        } catch (error) {
          check(`lecture:${file}`, false, `fichier illisible après édition : ${error.message}`);
          continue;
        }

        // 1. Intégrité AST.
        if (isJs(file)) {
          const validation = astParser.validate(content);
          check(`ast:${file}`, validation.valid, validation.valid ? 'AST valide' : validation.error);
        }

        // 2. Secrets introduits (on ne signale que les NOUVEAUX par rapport à l'état antérieur).
        const findings = securityScanner.scanText(file, content)
          .filter((finding) => finding.category === 'secret');
        const before = beforeState[file];
        const beforeFindings = typeof before === 'string'
          ? new Set(securityScanner.scanText(file, before).filter((finding) => finding.category === 'secret').map((finding) => finding.proof.split('—')[1]?.trim()))
          : new Set();
        const newSecrets = findings.filter((finding) => !beforeFindings.has(finding.proof.split('—')[1]?.trim()));
        check(`secrets:${file}`, newSecrets.length === 0,
          newSecrets.length > 0 ? newSecrets.map((finding) => finding.proof).join(' | ') : 'aucun secret introduit');

        // 4. Diff minimal.
        if (typeof before === 'string' && diffEngine) {
          const summary = diffEngine.diff({ original: before, modified: content, filePath: file });
          const beforeLines = Math.max(1, before.split('\n').length);
          const changedLines = summary.additions + summary.deletions;
          const ratio = changedLines / (beforeLines * 2);
          const massive = changedLines >= MASSIVE_REWRITE_MIN_CHANGED_LINES && ratio > MASSIVE_REWRITE_RATIO;
          check(`diff_minimal:${file}`, !massive,
            `${summary.additions} ajout(s), ${summary.deletions} suppression(s) sur ${beforeLines} ligne(s)`);
        }
      }

      // 6. Tests.
      if (runTests) {
        if (!testRunner) {
          check('tests', false, 'test_runner_indisponible');
        } else {
          const run = await testRunner.runAll({ bail: false });
          check('tests', run.failed === 0 && !run.crashed,
            `${run.passed ?? 0} verts, ${run.failed ?? 0} rouges${run.crashed ? ' (crash lanceur)' : ''}`);
        }
      }

      return Object.freeze({
        ok: checks.every((entry) => entry.ok),
        checks: Object.freeze(checks),
      });
    },
  });
}
