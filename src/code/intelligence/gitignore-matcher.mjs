// Matcher `.gitignore` pour l'indexeur de code : Mina Code ne doit PAS analyser ce que le dépôt
// ignore (prototypes morts, env/, sorties de build…). Sans ça, la revue crache des findings sur
// des fichiers qui ne partiront jamais sur GitHub — bruit pur avant publication.
//
// Couvre ce dont ce dépôt a besoin : commentaires, négation `!`, ancrage (motif avec `/` =
// relatif à la racine ; motif sans `/` = nom de base à n'importe quelle profondeur), dossiers
// (`/` final), `*` (dans un segment), `**` (à travers les segments), `?`. Le DERNIER motif qui
// matche gagne — c'est ainsi que `!.env.example` réautorise un fichier écarté par `.env.*`.

const escapeSegment = (value) => value.replace(/[.+^${}()|[\]\\]/gu, '\\$&');

function compilePattern(pattern) {
  const anchored = pattern.includes('/');
  // Traduction segment par segment pour distinguer `*` (dans un segment) de `**` (à travers).
  let body = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        body += '.*';
        i += 1;
        if (pattern[i + 1] === '/') i += 1; // `**/` absorbe le séparateur qui suit
      } else {
        body += '[^/]*';
      }
    } else if (char === '?') {
      body += '[^/]';
    } else if (char === '/') {
      body += '/';
    } else {
      body += escapeSegment(char);
    }
  }
  // Ancré → depuis la racine ; nom de base → à n'importe quelle profondeur.
  const prefix = anchored ? '' : '(?:.*/)?';
  return {
    self: new RegExp(`^${prefix}${body}$`, 'u'), // le chemin EST le motif
    under: new RegExp(`^${prefix}${body}/`, 'u'), // le chemin est SOUS le motif (un dossier)
    tree: new RegExp(`^${prefix}${body}(?:/.*)?$`, 'u'), // le motif et tout son sous-arbre
  };
}

/**
 * @param {string} content contenu brut d'un `.gitignore`
 * @returns {{ ignores: (relativePath: string, isDirectory?: boolean) => boolean }}
 */
export function createGitignoreMatcher(content = '') {
  const rules = [];
  for (const rawLine of String(content ?? '').split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+$/u, '');
    if (line === '' || line.startsWith('#')) continue;
    let pattern = line;
    let negated = false;
    if (pattern.startsWith('!')) { negated = true; pattern = pattern.slice(1); }
    // `\!` et `\#` échappent un `!`/`#` littéral en tête.
    if (pattern.startsWith('\\#') || pattern.startsWith('\\!')) pattern = pattern.slice(1);
    const directoryOnly = pattern.endsWith('/');
    if (directoryOnly) pattern = pattern.slice(0, -1);
    // Un `/` en tête ancre à la racine sans changer la sémantique « contient un slash ».
    if (pattern.startsWith('/')) pattern = pattern.slice(1);
    if (pattern === '') continue;
    rules.push({ ...compilePattern(pattern), negated, directoryOnly });
  }

  return Object.freeze({
    ignores(relativePath, isDirectory = false) {
      const normalized = String(relativePath ?? '').replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '');
      if (normalized === '') return false;
      let ignored = false;
      for (const rule of rules) {
        // Motif « dossier » (slash final) : écarte le dossier lui-même (s'il EST un dossier) ET
        // tout ce qui se trouve dessous (fichiers comme sous-dossiers). Un fichier homonyme du
        // dossier, lui, n'est pas écarté.
        const matched = rule.directoryOnly
          ? (rule.under.test(normalized) || (isDirectory && rule.self.test(normalized)))
          : rule.tree.test(normalized);
        if (matched) ignored = !rule.negated;
      }
      return ignored;
    },
  });
}
