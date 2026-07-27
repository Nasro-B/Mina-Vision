import { describe, expect, it } from 'vitest';
import { createAstParser } from '../../src/code/intelligence/ast-parser.mjs';
import { createSecurityScanner } from '../../src/code/review/security-scanner.mjs';
import { createStyleChecker } from '../../src/code/review/style-checker.mjs';
import { createCodeReviewer } from '../../src/code/review/code-reviewer.mjs';

// NB : toutes les chaînes « dangereuses » ci-dessous sont des DONNÉES de test pour le scanner —
// aucune n'est exécutée.

function contentMap(files) {
  return (path) => files[path] ?? null;
}

describe('security-scanner', () => {
  it('exige fileContent et un tableau de fichiers', () => {
    expect(() => createSecurityScanner({})).toThrow(/file_content_required/u);
    const scanner = createSecurityScanner({ fileContent: () => null });
    expect(() => scanner.scanSecrets('pas-un-tableau')).toThrow(/files_required/u);
  });

  it('détecte les secrets en dur avec preuve fichier:ligne', () => {
    // Fixture FAUSSE assemblée à l'exécution (F-12) : le scanner reçoit la même chaîne, mais
    // aucun littéral de forme « clé Google » ne subsiste dans le source du dépôt.
    const fakeGoogleKey = ['AIza', 'SyA1234567890', 'abcdefghijklmnopqrstuv'].join('');
    const scanner = createSecurityScanner({
      fileContent: contentMap({
        'config.mjs': [
          "const ok = process.env.API_KEY;",
          `const mauvais = '${fakeGoogleKey}';`,
          "const password = 'hunter2secret';",
        ].join('\n'),
      }),
    });
    const findings = scanner.scanSecrets(['config.mjs']);
    expect(findings.some((entry) => entry.pattern.includes('Google') && entry.line === 2)).toBe(true);
    expect(findings.every((entry) => entry.proof.startsWith('config.mjs:'))).toBe(true);
    expect(findings.some((entry) => entry.line === 1)).toBe(false);
  });

  it('détecte les motifs dangereux (données de test, jamais exécutées)', () => {
    const scanner = createSecurityScanner({
      fileContent: contentMap({
        'danger.mjs': [
          'const r = eva' + 'l(entree);',
          'element.innerHTML = html;',
          "const q = 'SELECT * FROM users WHERE id=' + id;",
          "fetch('http://api.exemple.com');",
          "fetch('http://localhost:3000');",
        ].join('\n'),
      }),
    });
    const findings = scanner.scanPatterns(['danger.mjs']);
    const names = findings.map((entry) => entry.pattern);
    expect(names.some((name) => name.includes('eval'))).toBe(true);
    expect(names.some((name) => name.includes('innerHTML'))).toBe(true);
    expect(names.some((name) => name.includes('SQL'))).toBe(true);
    expect(findings.filter((entry) => entry.pattern.includes('http')).map((entry) => entry.line)).toEqual([4]);
  });

  it('ignore les lignes de commentaire (documentation ≠ code exécutable)', () => {
    const scanner = createSecurityScanner({
      fileContent: contentMap({ 'doc.mjs': "// Pas d'eva" + "l() dans ce projet\nconst x = 1;" }),
    });
    expect(scanner.scanPatterns(['doc.mjs'])).toEqual([]);
  });

  it('scanText scanne un contenu direct (lignes de diff)', () => {
    const scanner = createSecurityScanner({ fileContent: () => null });
    const findings = scanner.scanText('diff', "const t = 'ghp_" + "abcdefghijklmnopqrstuvwx';");
    expect(findings.some((entry) => entry.pattern.includes('GitHub'))).toBe(true);
  });
});

describe('style-checker', () => {
  it('détecte console.log, var, TODO nu, classe et ligne trop longue', () => {
    const checker = createStyleChecker({
      fileContent: contentMap({
        'style.mjs': [
          "console.log('debug');",
          'var vieux = 1;',
          '// TODO corriger un jour',
          'class Machine {}',
          `const long = '${'x'.repeat(170)}';`,
        ].join('\n'),
      }),
    });
    const rules = checker.check({ files: ['style.mjs'] }).map((entry) => entry.rule);
    expect(rules.some((rule) => rule.includes('console.log'))).toBe(true);
    expect(rules.some((rule) => rule.includes('var'))).toBe(true);
    expect(rules.some((rule) => rule.includes('TODO'))).toBe(true);
    expect(rules.some((rule) => rule.includes('classe'))).toBe(true);
    expect(rules.some((rule) => rule.includes('trop longue'))).toBe(true);
  });

  it('TODO(Mina Code) suivi est toléré, fonctions trop longues mesurées à l\'AST', () => {
    const longFunction = `function géante() {\n  let total = 0;\n${'  total += 1;\n'.repeat(85)}  return total;\n}\n`;
    const checker = createStyleChecker({
      fileContent: contentMap({ 'long.mjs': `// TODO(Mina Code): suivi\n${longFunction}` }),
      astParser: createAstParser(),
    });
    const findings = checker.check({ files: ['long.mjs'] });
    expect(findings.some((entry) => entry.rule.includes('TODO'))).toBe(false);
    const long = findings.find((entry) => entry.rule.includes('fonction trop longue'));
    expect(long).toBeDefined();
    expect(long.proof).toContain('géante');
  });

  it('valide ses entrées', () => {
    expect(() => createStyleChecker({})).toThrow(/file_content_required/u);
    const checker = createStyleChecker({ fileContent: () => null });
    expect(() => checker.check({ files: [] })).toThrow(/files_required/u);
  });
});

describe('code-reviewer', () => {
  function buildReviewer(files) {
    const fileContent = contentMap(files);
    return createCodeReviewer({
      astParser: createAstParser(),
      securityScanner: createSecurityScanner({ fileContent }),
      styleChecker: createStyleChecker({ fileContent }),
      fileContent,
    });
  }

  it('exige toutes ses dépendances et des fichiers', async () => {
    expect(() => createCodeReviewer({})).toThrow(/ast_parser_required/u);
    const reviewer = buildReviewer({});
    await expect(reviewer.review({})).rejects.toThrow(/files_required/u);
  });

  it('fichier non parsable → finding critical avec preuve d\'erreur AST', async () => {
    const reviewer = buildReviewer({ 'cassé.mjs': 'function {' });
    const report = await reviewer.review({ files: ['cassé.mjs'] });
    const critical = report.findings.find((entry) => entry.title === 'fichier non parsable');
    expect(critical.severity).toBe('critical');
    expect(critical.proof).toMatch(/ast_parse_failed/u);
  });

  it('agrège sécurité + style + logique avec résumé par sévérité et règles Mina réelles', async () => {
    const reviewer = buildReviewer({
      'mixte.mjs': [
        "const secret = 'ghp_" + "abcdefghijklmnopqrstuvwx';",
        'if (a == b) { faire(); }',
        "console.log('reste');",
      ].join('\n'),
    });
    const report = await reviewer.review({ files: ['mixte.mjs'] });
    expect(report.clean).toBe(false);
    const categories = new Set(report.findings.map((entry) => entry.category));
    expect(categories.has('secret')).toBe(true);
    expect(categories.has('logic')).toBe(true);
    expect(categories.has('style')).toBe(true);
    expect(report.summary.critical + report.summary.high + report.summary.medium + report.summary.low)
      .toBe(report.findings.length);
    expect(report.findings.every((entry) => entry.rule.startsWith('Règle Mina Code n°'))).toBe(true);
    expect(report.findings.every((entry) => typeof entry.proof === 'string' && entry.proof.length > 0)).toBe(true);
  });

  it('focus=security ne rapporte pas le style', async () => {
    const fakeGoogleKey = ['AIza', 'SyA1234567890', 'abcdefghijklmnopqrstuv'].join(''); // fixture (F-12)
    const reviewer = buildReviewer({ 'mixte.mjs': `console.log('x');\nconst p = '${fakeGoogleKey}';` });
    const report = await reviewer.review({ files: ['mixte.mjs'], focus: 'security' });
    expect(report.findings.some((entry) => entry.category === 'style')).toBe(false);
    expect(report.findings.some((entry) => entry.category === 'secret')).toBe(true);
  });

  it('fichier propre → clean true', async () => {
    const reviewer = buildReviewer({ 'propre.mjs': "export const somme = (a, b) => a + b;" });
    const report = await reviewer.review({ files: ['propre.mjs'] });
    expect(report.clean).toBe(true);
  });

  it('quickReview n\'examine QUE les lignes ajoutées du diff', async () => {
    const reviewer = buildReviewer({});
    const diff = [
      '--- a/x.mjs',
      '+++ b/x.mjs',
      '-if (a == b) { ancien(); }',
      '+if (a === b) { propre(); }',
      '+if (c == d) { nouveau(); }',
    ].join('\n');
    const result = await reviewer.quickReview(diff);
    expect(result.linesReviewed).toBe(2);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].proof).toContain('c == d');
    await expect(reviewer.quickReview('')).rejects.toThrow(/diff_required/u);
  });
});
