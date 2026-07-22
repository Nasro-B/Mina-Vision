// Indexeur principal du codebase : marche l'arborescence (jamais node_modules/.git, jamais les
// symlinks — règle OOM machine), parse chaque fichier JS, peuple l'index de symboles et les deux
// graphes, et invalide par hash SHA-256 pour l'indexation incrémentale.

const INDEXABLE_EXTENSIONS = Object.freeze(['.mjs', '.cjs', '.js']);
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.vercel', 'out']);
const MAX_FILE_BYTES = 1_500_000;

const toPosix = (value) => String(value).replace(/\\/gu, '/');

function resolveImport(fromFile, source) {
  if (typeof source !== 'string' || !source.startsWith('.')) return null;
  const fromParts = toPosix(fromFile).split('/');
  fromParts.pop();
  for (const segment of toPosix(source).split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') fromParts.pop();
    else fromParts.push(segment);
  }
  return fromParts.join('/');
}

export function createCodebaseIndexer({
  astParser,
  callGraph,
  dependencyGraph,
  symbolIndex,
  vectorStore = null,
  fileReader,
  projectRoot,
} = {}) {
  if (!astParser || !callGraph || !dependencyGraph || !symbolIndex) {
    throw new TypeError('codebase_indexer_dependencies_required');
  }
  if (!fileReader || typeof fileReader.readFile !== 'function' || typeof fileReader.readdir !== 'function') {
    throw new TypeError('codebase_indexer_file_reader_required');
  }
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('codebase_indexer_root_required');
  }

  const contents = new Map();
  let lastIndexedAt = null;
  let totalCandidates = 0;

  const absolute = (relative) => `${projectRoot.replace(/[\\/]+$/u, '')}/${relative}`;

  async function listSourceFiles() {
    const found = [];
    async function walk(relative) {
      let dirents;
      try {
        dirents = await fileReader.readdir(relative === '' ? projectRoot : absolute(relative), { withFileTypes: true });
      } catch {
        return;
      }
      for (const dirent of dirents) {
        if (typeof dirent.isSymbolicLink === 'function' && dirent.isSymbolicLink()) continue;
        const name = dirent.name;
        const path = relative === '' ? name : `${relative}/${name}`;
        if (typeof dirent.isDirectory === 'function' && dirent.isDirectory()) {
          if (IGNORED_DIRECTORIES.has(name)) continue;
          await walk(path);
        } else if (INDEXABLE_EXTENSIONS.some((extension) => name.endsWith(extension))) {
          found.push(path);
        }
      }
    }
    await walk('');
    return found.sort();
  }

  async function indexOneFile(relativePath) {
    let source;
    try {
      source = String(await fileReader.readFile(absolute(relativePath), 'utf8'));
    } catch (error) {
      return { file: relativePath, indexed: false, reason: `lecture_impossible: ${error.message}` };
    }
    if (source.length > MAX_FILE_BYTES) {
      return { file: relativePath, indexed: false, reason: 'fichier_trop_gros' };
    }
    const previousHash = symbolIndex.hashOf(relativePath);
    const nextHash = astParser.fileHash(source);
    if (previousHash === nextHash) {
      return { file: relativePath, indexed: false, reason: 'inchangé' };
    }

    const parsed = astParser.parseFile(source, { filePath: relativePath });
    contents.set(relativePath, source);
    symbolIndex.addFile(relativePath, parsed);
    const resolvedImports = parsed.imports
      .map((entry) => resolveImport(relativePath, entry.source))
      .filter(Boolean);
    dependencyGraph.setFile(relativePath, resolvedImports);

    // Arêtes du call-graph : résolution par nom, d'abord locale puis via un symbole exporté ailleurs.
    for (const call of parsed.calls) {
      const caller = parsed.symbols.find((symbol) => symbol.name === call.callerName)
        ?? { id: `${relativePath}::(module)` };
      const localCallee = parsed.symbols.find((symbol) => symbol.name === call.calleeName);
      const externalCallee = localCallee ?? symbolIndex.byName(call.calleeName, { exact: true })
        .find((symbol) => symbol.visibility === 'exported');
      if (!externalCallee) continue;
      callGraph.addEdge({
        callerId: caller.id,
        calleeId: externalCallee.id,
        callSite: `${relativePath}:${call.line}`,
      });
    }

    if (vectorStore && typeof vectorStore.upsert === 'function') {
      try {
        for (const symbol of parsed.symbols) {
          await vectorStore.upsert({
            id: symbol.id,
            text: `${symbol.kind} ${symbol.name} (${relativePath})`,
            metadata: { file: relativePath, kind: symbol.kind, name: symbol.name },
          });
        }
      } catch {
        // Le vector store est optionnel : son échec ne casse jamais l'indexation.
      }
    }
    return { file: relativePath, indexed: true, symbols: parsed.symbols.length, ...(parsed.error ? { parseError: parsed.error } : {}) };
  }

  async function runIndex(files, onProgress) {
    const report = { indexed: 0, skipped: 0, errors: [] };
    let done = 0;
    for (const file of files) {
      const result = await indexOneFile(file);
      if (result.indexed) report.indexed += 1;
      else report.skipped += 1;
      if (result.parseError) report.errors.push({ file, error: result.parseError });
      if (result.reason?.startsWith('lecture_impossible')) report.errors.push({ file, error: result.reason });
      done += 1;
      if (typeof onProgress === 'function') onProgress({ done, total: files.length, file });
    }
    lastIndexedAt = new Date().toISOString();
    return Object.freeze({ ...report, total: files.length, errors: Object.freeze(report.errors) });
  }

  return Object.freeze({
    async fullIndex({ onProgress } = {}) {
      const files = await listSourceFiles();
      totalCandidates = files.length;
      return runIndex(files, onProgress);
    },

    async incrementalIndex({ changedFiles, onProgress } = {}) {
      if (!Array.isArray(changedFiles)) throw new Error('codebase_indexer_changed_files_required');
      return runIndex(changedFiles.map(toPosix), onProgress);
    },

    searchSymbol: (query) => symbolIndex.byName(query),

    findUsages(symbolId) {
      const chains = callGraph.callers(symbolId, 1);
      return Object.freeze(chains.map((chain) => chain[0]).map((callerId) => ({
        callerId,
        caller: symbolIndex.get(callerId),
      })));
    },

    getDependencies(filePath) {
      const posix = toPosix(filePath);
      return Object.freeze({
        direct: dependencyGraph.directDependencies(posix),
        transitive: dependencyGraph.transitiveDependencies(posix),
        dependents: dependencyGraph.dependents(posix),
      });
    },

    impactAnalysis(changedFile) {
      const posix = toPosix(changedFile);
      const affected = dependencyGraph.affectedBy([posix]);
      return Object.freeze({
        changedFile: posix,
        affectedFiles: affected,
        affectedTests: Object.freeze(affected.filter((file) => file.includes('.test.'))),
        riskLevel: affected.length === 0 ? 'faible' : affected.length <= 3 ? 'moyen' : 'élevé',
      });
    },

    fileContent: (filePath) => contents.get(toPosix(filePath)) ?? null,
    indexedFiles: () => symbolIndex.files(),

    status() {
      return Object.freeze({
        indexedFiles: symbolIndex.files().length,
        totalFiles: totalCandidates,
        lastIndexedAt,
        symbols: symbolIndex.stats().symbols,
      });
    },
  });
}
