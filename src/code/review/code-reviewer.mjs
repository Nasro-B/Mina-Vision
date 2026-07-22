// Reviewer de code : agrège parse AST (erreurs de syntaxe), scanner sécurité, vérificateur de
// style, et heuristiques logiques/performance. Chaque finding référence une des 10 règles Mina
// Code (les VRAIES règles de code-personality — pas un référentiel inventé) et embarque sa preuve.

const MINA_RULES = Object.freeze({
  securite: 'Règle Mina Code n°6 — Pas de secrets en dur, pas d\'eval, pas d\'injection',
  edition: 'Règle Mina Code n°2 — Modifier uniquement les lignes nécessaires',
  tests: 'Règle Mina Code n°3 — Test rouge d\'abord, suite verte exigée',
  incertitude: 'Règle Mina Code n°8 — Dire « je ne sais pas » plutôt qu\'inventer',
});

const LOGIC_PATTERNS = Object.freeze([
  {
    name: 'égalité faible ==/!=',
    regex: /[^=!<>]==[^=]|!=[^=]/u,
    severity: 'medium',
    category: 'logic',
    advice: 'utiliser === / !== (coercition implicite source de bugs)',
  },
  {
    name: 'catch muet (erreur avalée sans trace)',
    regex: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/u,
    severity: 'medium',
    category: 'logic',
    advice: 'journaliser ou commenter explicitement pourquoi l\'erreur est ignorée',
  },
  {
    name: 'await dans une boucle for (séquentialisation involontaire ?)',
    regex: /for\s*\([^)]*\)\s*\{[^}]*\bawait\b/u,
    severity: 'low',
    category: 'performance',
    advice: 'si les itérations sont indépendantes, paralléliser (Promise.all)',
  },
]);

export function createCodeReviewer({ astParser, securityScanner, styleChecker, fileContent } = {}) {
  if (!astParser) throw new TypeError('code_reviewer_ast_parser_required');
  if (!securityScanner) throw new TypeError('code_reviewer_security_scanner_required');
  if (!styleChecker) throw new TypeError('code_reviewer_style_checker_required');
  if (typeof fileContent !== 'function') throw new TypeError('code_reviewer_file_content_required');

  const isJs = (file) => /\.(?:mjs|cjs|js)$/u.test(file);

  function logicFindings(files) {
    const findings = [];
    for (const file of files) {
      const content = fileContent(file);
      if (!content) continue;
      const lines = String(content).split('\n');
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        for (const pattern of LOGIC_PATTERNS) {
          if (!pattern.regex.test(line)) continue;
          findings.push(Object.freeze({
            title: pattern.name,
            severity: pattern.severity,
            category: pattern.category,
            file,
            startLine: index + 1,
            endLine: index + 1,
            suggestion: pattern.advice,
            rule: MINA_RULES.edition,
            proof: `${file}:${index + 1} — ${trimmed.slice(0, 160)}`,
          }));
        }
      });
    }
    return findings;
  }

  function toFinding(raw, fallbackCategory) {
    return Object.freeze({
      title: raw.pattern ?? raw.rule ?? 'finding',
      severity: raw.severity ?? 'low',
      category: raw.category ?? fallbackCategory,
      file: raw.file,
      startLine: raw.line ?? 0,
      endLine: raw.line ?? 0,
      suggestion: raw.advice ?? null,
      rule: raw.category === 'secret' || raw.category === 'security' ? MINA_RULES.securite : MINA_RULES.edition,
      proof: raw.proof,
    });
  }

  async function review({ files, focus = 'all' } = {}) {
    if (!Array.isArray(files) || files.length === 0) throw new Error('code_reviewer_files_required');
    const findings = [];

    // 1. Intégrité syntaxique — un fichier qui ne parse pas est un finding critique.
    for (const file of files.filter(isJs)) {
      const content = fileContent(file);
      if (!content) continue;
      const validation = astParser.validate(String(content));
      if (!validation.valid) {
        findings.push(Object.freeze({
          title: 'fichier non parsable',
          severity: 'critical',
          category: 'logic',
          file,
          startLine: 0,
          endLine: 0,
          suggestion: 'corriger la syntaxe avant toute autre revue',
          rule: MINA_RULES.tests,
          proof: validation.error,
        }));
      }
    }

    if (focus === 'all' || focus === 'security') {
      for (const raw of securityScanner.scanAll(files)) findings.push(toFinding(raw, 'security'));
    }
    if (focus === 'all' || focus === 'style') {
      for (const raw of styleChecker.check({ files })) findings.push(toFinding(raw, 'style'));
    }
    if (focus === 'all' || focus === 'logic' || focus === 'performance') {
      findings.push(...logicFindings(files.filter(isJs)));
    }

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const finding of findings) bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;

    return Object.freeze({
      files: Object.freeze([...files]),
      focus,
      findings: Object.freeze(findings),
      summary: Object.freeze(bySeverity),
      clean: findings.length === 0,
    });
  }

  async function quickReview(diffText) {
    if (typeof diffText !== 'string' || diffText.length === 0) throw new Error('code_reviewer_diff_required');
    // Revue rapide : seules les lignes AJOUTÉES du diff sont examinées.
    const added = diffText.split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1));
    const virtualFile = 'diff(ajouts)';
    const content = added.join('\n');
    const findings = [];
    if (typeof securityScanner.scanText === 'function') {
      for (const raw of securityScanner.scanText(virtualFile, content)) findings.push(toFinding(raw, 'security'));
    }
    added.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//')) return;
      for (const pattern of LOGIC_PATTERNS) {
        if (pattern.regex.test(line)) {
          findings.push(Object.freeze({
            title: pattern.name,
            severity: pattern.severity,
            category: pattern.category,
            file: virtualFile,
            startLine: index + 1,
            endLine: index + 1,
            suggestion: pattern.advice,
            rule: MINA_RULES.edition,
            proof: `${virtualFile}:${index + 1} — ${trimmed.slice(0, 160)}`,
          }));
        }
      }
    });
    return Object.freeze({ findings: Object.freeze(findings), linesReviewed: added.length });
  }

  return Object.freeze({ review, quickReview });
}
