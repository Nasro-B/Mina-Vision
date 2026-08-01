// Index de symboles en mémoire : source de vérité partagée par le call-graph, le graphe de
// dépendances et la recherche. Remplacement atomique par fichier (removeFile + addFile).

export function createSymbolIndex() {
  const byFileMap = new Map();
  const byIdMap = new Map();
  const exactNameMap = new Map();

  function addExactName(symbol) {
    const name = symbol.name.toLowerCase();
    if (!exactNameMap.has(name)) exactNameMap.set(name, new Map());
    exactNameMap.get(name).set(symbol.id, symbol);
  }

  function removeExactName(symbol) {
    const name = symbol.name.toLowerCase();
    const matches = exactNameMap.get(name);
    if (!matches) return;
    matches.delete(symbol.id);
    if (matches.size === 0) exactNameMap.delete(name);
  }

  function removeFile(filePath) {
    const existing = byFileMap.get(filePath);
    if (!existing) return false;
    for (const symbol of existing.symbols) {
      byIdMap.delete(symbol.id);
      removeExactName(symbol);
    }
    byFileMap.delete(filePath);
    return true;
  }

  function addFile(filePath, { symbols = [], imports = [], exports = [], calls = [], hash = null } = {}) {
    if (typeof filePath !== 'string' || filePath.length === 0) throw new Error('symbol_index_file_required');
    removeFile(filePath);
    const record = Object.freeze({
      filePath,
      hash,
      symbols: Object.freeze([...symbols]),
      imports: Object.freeze([...imports]),
      exports: Object.freeze([...exports]),
      calls: Object.freeze([...calls]),
    });
    byFileMap.set(filePath, record);
    for (const symbol of record.symbols) {
      byIdMap.set(symbol.id, symbol);
      addExactName(symbol);
    }
    return record;
  }

  return Object.freeze({
    addFile,
    removeFile,
    get: (id) => byIdMap.get(id) ?? null,
    byFile: (filePath) => byFileMap.get(filePath) ?? null,
    files: () => Object.freeze([...byFileMap.keys()]),
    byName(name, { exact = false } = {}) {
      const needle = String(name ?? '').toLowerCase();
      if (!needle) return Object.freeze([]);
      if (exact) return Object.freeze([...(exactNameMap.get(needle)?.values() ?? [])]);
      const results = [];
      for (const symbol of byIdMap.values()) {
        const candidate = symbol.name.toLowerCase();
        if (candidate.includes(needle)) results.push(symbol);
      }
      return Object.freeze(results);
    },
    byKind(kind) {
      return Object.freeze([...byIdMap.values()].filter((symbol) => symbol.kind === kind));
    },
    exportsOf(filePath) {
      return Object.freeze(byFileMap.get(filePath)?.exports ?? []);
    },
    importsOf(filePath) {
      return Object.freeze(byFileMap.get(filePath)?.imports ?? []);
    },
    callsOf(filePath) {
      return Object.freeze(byFileMap.get(filePath)?.calls ?? []);
    },
    hashOf: (filePath) => byFileMap.get(filePath)?.hash ?? null,
    stats() {
      return Object.freeze({
        files: byFileMap.size,
        symbols: byIdMap.size,
      });
    },
  });
}
