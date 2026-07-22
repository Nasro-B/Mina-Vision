// Scanner de sécurité statique : secrets en dur et motifs dangereux, avec preuve réelle
// (fichier + ligne + extrait matché) pour chaque finding. Les regex ci-dessous DÉCRIVENT des
// motifs à détecter — aucune n'est exécutée comme code.

const SECRET_PATTERNS = Object.freeze([
  { name: 'clé Google (AIza…)', regex: /\bAIza[0-9A-Za-z_-]{30,}/u, severity: 'critical' },
  { name: 'clé OpenAI/API (sk-…)', regex: /\bsk-[A-Za-z0-9_-]{16,}/u, severity: 'critical' },
  { name: 'token GitHub (ghp_…)', regex: /\bghp_[A-Za-z0-9]{20,}/u, severity: 'critical' },
  { name: 'token HuggingFace (hf_…)', regex: /\bhf_[A-Za-z0-9]{20,}/u, severity: 'critical' },
  { name: 'clé AWS (AKIA…)', regex: /\bAKIA[0-9A-Z]{16}\b/u, severity: 'critical' },
  { name: 'bloc de clé privée PEM', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u, severity: 'critical' },
  { name: 'mot de passe en dur', regex: /\b(?:password|passwd|pwd)\s*[=:]\s*['"][^'"]{4,}['"]/iu, severity: 'high' },
  { name: 'token/secret en dur', regex: /\b(?:token|secret|api_?key)\s*[=:]\s*['"][A-Za-z0-9+/_-]{12,}['"]/iu, severity: 'high' },
]);

const DANGEROUS_PATTERNS = Object.freeze([
  { name: 'eval()', regex: /(?<![.\w])eval\s*\(/u, severity: 'critical', category: 'security' },
  { name: 'new Function()', regex: /new\s+Function\s*\(/u, severity: 'critical', category: 'security' },
  { name: 'innerHTML/outerHTML', regex: /\.(?:inner|outer)HTML\s*=/u, severity: 'high', category: 'security' },
  { name: 'document.write()', regex: /document\.write\s*\(/u, severity: 'high', category: 'security' },
  { name: 'exec/execSync enfant', regex: /\b(?:child_process\.)?exec(?:Sync)?\s*\(\s*[`'"]?.*\$\{/u, severity: 'critical', category: 'security' },
  { name: 'require() dynamique variable', regex: /require\s*\(\s*[^'")\s][^)]*\)/u, severity: 'medium', category: 'security' },
  { name: 'SQL concaténé', regex: /['"`]\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^'"`]*['"`]\s*\+/iu, severity: 'high', category: 'security' },
  { name: 'URL http:// non TLS', regex: /['"`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/u, severity: 'medium', category: 'security' },
  { name: 'secret d\'environnement journalisé', regex: /console\.\w+\([^)]*process\.env\.\w*(?:KEY|TOKEN|SECRET|PASSWORD)/iu, severity: 'high', category: 'security' },
]);

function scanContent(filePath, content, patterns, category) {
  const findings = [];
  const lines = String(content).split('\n');
  lines.forEach((line, index) => {
    // Les lignes de commentaire pur ne constituent pas un code dangereux exécutable.
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      const match = line.match(pattern.regex);
      if (!match) continue;
      findings.push(Object.freeze({
        file: filePath,
        line: index + 1,
        pattern: pattern.name,
        severity: pattern.severity,
        category: pattern.category ?? category,
        proof: `${filePath}:${index + 1} — ${trimmed.slice(0, 160)}`,
      }));
    }
  });
  return findings;
}

export function createSecurityScanner({ fileContent } = {}) {
  if (typeof fileContent !== 'function') throw new TypeError('security_scanner_file_content_required');

  const scanWith = (files, patterns, category) => {
    if (!Array.isArray(files)) throw new Error('security_scanner_files_required');
    const findings = [];
    for (const file of files) {
      const content = fileContent(file);
      if (content === null || content === undefined) continue;
      findings.push(...scanContent(file, content, patterns, category));
    }
    return Object.freeze(findings);
  };

  return Object.freeze({
    scanSecrets: (files) => scanWith(files, SECRET_PATTERNS, 'secret'),
    scanPatterns: (files) => scanWith(files, DANGEROUS_PATTERNS, 'security'),
    scanAll: (files) => Object.freeze([
      ...scanWith(files, SECRET_PATTERNS, 'secret'),
      ...scanWith(files, DANGEROUS_PATTERNS, 'security'),
    ]),
    // Scan direct d'un contenu déjà en main (ex. lignes ajoutées d'un diff) sans passer par fileContent.
    scanText: (label, content) => Object.freeze([
      ...scanContent(label, content, SECRET_PATTERNS, 'secret'),
      ...scanContent(label, content, DANGEROUS_PATTERNS, 'security'),
    ]),
  });
}
