// Recherche dans le codebase : vectorielle si un vector store est branché, lexicale sinon
// (score par nom de symbole, chemin et contenu). Fournit aussi les recherches structurelles :
// motifs regex, sites d'appel, fichiers sans tests, code mort.

const DEFAULT_MAX_RESULTS = 10;

export function createCodeSemanticSearch({
  symbolIndex,
  vectorStore = null,
  callGraph = null,
  fileContent = () => null,
} = {}) {
  if (!symbolIndex) throw new TypeError('code_semantic_search_symbol_index_required');

  function lexicalSearch(query, { maxResults, fileFilter }) {
    const terms = String(query).toLowerCase().split(/\s+/u).filter(Boolean);
    if (terms.length === 0) return [];
    const results = [];
    for (const filePath of symbolIndex.files()) {
      if (fileFilter && !filePath.includes(fileFilter)) continue;
      const record = symbolIndex.byFile(filePath);
      const content = String(fileContent(filePath) ?? '').toLowerCase();
      for (const symbol of record.symbols) {
        const name = symbol.name.toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (name === term) score += 10;
          else if (name.includes(term)) score += 5;
          if (filePath.toLowerCase().includes(term)) score += 2;
          if (content.includes(term)) score += 1;
        }
        if (score > 0) results.push({ symbol, file: filePath, score });
      }
    }
    return results
      .sort((a, b) => b.score - a.score || a.symbol.name.localeCompare(b.symbol.name))
      .slice(0, maxResults);
  }

  return Object.freeze({
    async search(query, { maxResults = DEFAULT_MAX_RESULTS, fileFilter } = {}) {
      if (typeof query !== 'string' || query.trim().length === 0) {
        throw new Error('code_semantic_search_query_required');
      }
      if (vectorStore && typeof vectorStore.search === 'function') {
        try {
          const hits = await vectorStore.search(query, { maxResults });
          if (Array.isArray(hits) && hits.length > 0) {
            return Object.freeze(hits.map((hit) => Object.freeze({
              symbol: symbolIndex.get(hit.id) ?? null,
              file: hit.metadata?.file ?? null,
              score: hit.score ?? 0,
              source: 'vectorielle',
            })));
          }
        } catch {
          // Vector store en panne → repli lexical silencieux (fail-soft).
        }
      }
      return Object.freeze(lexicalSearch(query, { maxResults, fileFilter })
        .map((entry) => Object.freeze({ ...entry, source: 'lexicale' })));
    },

    findSymbol(name, { kind, file } = {}) {
      let results = symbolIndex.byName(name, { exact: true });
      if (results.length === 0) results = symbolIndex.byName(name);
      return Object.freeze(results.filter((symbol) => (
        (kind === undefined || symbol.kind === kind)
        && (file === undefined || symbol.file.includes(file))
      )));
    },

    findPattern(pattern, { fileGlob, contextLines = 1 } = {}) {
      let regex;
      try {
        regex = new RegExp(pattern, 'gu');
      } catch (error) {
        throw new Error(`code_semantic_search_pattern_invalid: ${error.message}`);
      }
      const matches = [];
      for (const filePath of symbolIndex.files()) {
        if (fileGlob && !filePath.includes(fileGlob.replace(/\*/gu, ''))) continue;
        const content = fileContent(filePath);
        if (content === null) continue;
        const lines = String(content).split('\n');
        lines.forEach((line, index) => {
          regex.lastIndex = 0;
          if (!regex.test(line)) return;
          const start = Math.max(0, index - contextLines);
          const end = Math.min(lines.length, index + contextLines + 1);
          matches.push(Object.freeze({
            file: filePath,
            line: index + 1,
            match: line.trim(),
            context: Object.freeze(lines.slice(start, end)),
          }));
        });
      }
      return Object.freeze(matches);
    },

    findAllCalls(functionName) {
      const sites = [];
      for (const filePath of symbolIndex.files()) {
        for (const call of symbolIndex.callsOf(filePath)) {
          if (call.calleeName === functionName || call.calleeName.endsWith(`.${functionName}`)) {
            sites.push(Object.freeze({ file: filePath, line: call.line, caller: call.callerName }));
          }
        }
      }
      return Object.freeze(sites);
    },

    findUntestedFiles() {
      const files = symbolIndex.files();
      const testFiles = files.filter((file) => file.includes('.test.'));
      const testedBasenames = new Set();
      for (const testFile of testFiles) {
        const base = testFile.split('/').pop().replace(/\.test\.[cm]?js$/u, '');
        testedBasenames.add(base);
        const content = fileContent(testFile);
        if (content) {
          for (const match of String(content).matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
            testedBasenames.add(match[1].split('/').pop().replace(/\.[cm]?js$/u, ''));
          }
        }
      }
      return Object.freeze(files.filter((file) => {
        if (file.includes('.test.') || file.includes('tests/')) return false;
        const base = file.split('/').pop().replace(/\.[cm]?js$/u, '');
        return !testedBasenames.has(base);
      }));
    },

    findDeadCode() {
      const dead = [];
      const importedNames = new Set();
      for (const filePath of symbolIndex.files()) {
        for (const entry of symbolIndex.importsOf(filePath)) {
          for (const specifier of entry.specifiers ?? []) importedNames.add(specifier);
        }
      }
      for (const filePath of symbolIndex.files()) {
        const record = symbolIndex.byFile(filePath);
        for (const symbol of record.symbols) {
          if (symbol.visibility !== 'exported') continue;
          const isImported = importedNames.has(symbol.name);
          const isCalled = callGraph ? callGraph.callers(symbol.id, 1).length > 0 : false;
          if (!isImported && !isCalled) {
            dead.push(Object.freeze({ symbol, file: filePath, reason: 'exporté mais jamais importé ni appelé (dans le périmètre indexé)' }));
          }
        }
      }
      return Object.freeze(dead);
    },
  });
}
