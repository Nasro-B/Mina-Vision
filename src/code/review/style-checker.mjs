// Vérificateur de style : conventions RÉELLES du codebase Mina Vision (factory functions,
// zéro classe, pas de var, pas de console.log résiduel, erreurs nominées snake_case).
// Chaque finding embarque sa preuve (fichier:ligne + extrait).

const RULES = Object.freeze([
  {
    name: 'console.log résiduel',
    regex: /(?<![.\w])console\.log\s*\(/u,
    severity: 'low',
    advice: 'utiliser le journal technique ou retirer avant commit',
  },
  {
    name: 'var (utiliser const/let)',
    regex: /(?<![.\w])var\s+\w/u,
    severity: 'medium',
    advice: 'const par défaut, let si réassignation',
  },
  {
    name: 'TODO/FIXME non suivi',
    regex: /\/\/\s*(?:TODO|FIXME)\b(?!\(Mina Code\))/u,
    severity: 'low',
    advice: 'transformer en tâche suivie ou traiter',
  },
  {
    name: 'classe (convention codebase : factory functions)',
    regex: /(?<![.\w])class\s+[A-Z]\w*/u,
    severity: 'medium',
    advice: 'préférer createXxx({ dépendances }) → Object.freeze({...})',
  },
  {
    name: 'ligne trop longue (> 160)',
    regex: /^.{161,}$/u,
    severity: 'low',
    advice: 'couper la ligne',
  },
]);

const MAX_FUNCTION_LINES = 80;

export function createStyleChecker({ fileContent, astParser = null } = {}) {
  if (typeof fileContent !== 'function') throw new TypeError('style_checker_file_content_required');

  return Object.freeze({
    check({ files } = {}) {
      if (!Array.isArray(files) || files.length === 0) throw new Error('style_checker_files_required');
      const findings = [];
      for (const file of files) {
        const content = fileContent(file);
        if (content === null || content === undefined) continue;
        const lines = String(content).split('\n');
        lines.forEach((line, index) => {
          const trimmed = line.trim();
          const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
          for (const rule of RULES) {
            if (isComment && !rule.name.startsWith('TODO')) continue;
            if (!rule.regex.test(rule.name.includes('trop longue') ? line : line)) continue;
            findings.push(Object.freeze({
              file,
              line: index + 1,
              rule: rule.name,
              severity: rule.severity,
              category: 'style',
              advice: rule.advice,
              proof: `${file}:${index + 1} — ${trimmed.slice(0, 160)}`,
            }));
          }
        });

        // Fonctions trop longues, mesurées sur l'AST réel quand un parseur est fourni.
        if (astParser) {
          const parsed = astParser.parseFile(String(content), { filePath: file });
          for (const symbol of parsed.symbols) {
            if (!['function', 'method'].includes(symbol.kind)) continue;
            const length = symbol.endLine - symbol.startLine + 1;
            if (length > MAX_FUNCTION_LINES) {
              findings.push(Object.freeze({
                file,
                line: symbol.startLine,
                rule: `fonction trop longue (${length} lignes > ${MAX_FUNCTION_LINES})`,
                severity: 'medium',
                category: 'architecture',
                advice: 'extraire des sous-fonctions nommées',
                proof: `${file}:${symbol.startLine} — ${symbol.name} (${length} lignes)`,
              }));
            }
          }
        }
      }
      return Object.freeze(findings);
    },
  });
}
