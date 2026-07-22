function chunkText(source, chunkLines) {
  const lines = source.text.split(/\r?\n/u);
  const chunks = [];
  for (let start = 0; start < lines.length; start += chunkLines) {
    const end = Math.min(lines.length, start + chunkLines);
    chunks.push(Object.freeze({
      path: source.path,
      digest: source.digest,
      mtime: source.mtime,
      lineStart: start + 1,
      lineEnd: end,
      method: source.method,
      content: lines.slice(start, end).join('\n'),
    }));
  }
  return chunks;
}

export function createFileIndexer({
  fileReader,
  sink,
  maxJobBytes = 250 * 1024 * 1024,
  maxJobFiles = 10_000,
  timeoutMs = 10 * 60 * 1_000,
  chunkLines = 200,
  now = Date.now,
} = {}) {
  if (!fileReader?.read || !sink?.upsertFile || !sink?.removeFile) {
    throw new TypeError('file_indexer_dependencies_required');
  }
  const indexed = new Map();

  async function readBounded(paths) {
    if (paths.length > maxJobFiles) throw new Error('file_job_count_limit');
    const startedAt = now();
    const sources = [];
    let bytes = 0;
    for (const path of paths) {
      if (now() - startedAt > timeoutMs) throw new Error('file_job_timeout');
      const source = await fileReader.read({ path, operation: 'index' });
      bytes += source.size;
      if (bytes > maxJobBytes) throw new Error('file_job_byte_limit');
      sources.push(source);
    }
    return { sources, bytes };
  }

  async function upsertSources(sources) {
    let changed = 0;
    let skipped = 0;
    for (const source of sources) {
      if (indexed.get(source.path) === source.digest) {
        skipped += 1;
        continue;
      }
      await sink.upsertFile({ source, chunks: chunkText(source, chunkLines) });
      indexed.set(source.path, source.digest);
      changed += 1;
    }
    return { changed, skipped };
  }

  async function reconcile(paths) {
    const { sources, bytes } = await readBounded(paths);
    const current = new Set(sources.map(({ path }) => path));
    let removed = 0;
    for (const path of [...indexed.keys()]) {
      if (!current.has(path)) {
        await sink.removeFile(path);
        indexed.delete(path);
        removed += 1;
      }
    }
    const result = await upsertSources(sources);
    return Object.freeze({ indexed: result.changed, skipped: result.skipped, removed, bytes });
  }

  async function refresh(path) {
    try {
      const { sources } = await readBounded([path]);
      return upsertSources(sources);
    } catch (error) {
      if (error?.code !== 'ENOENT' || !indexed.has(path)) throw error;
      await sink.removeFile(path);
      indexed.delete(path);
      return { changed: 0, skipped: 0, removed: 1 };
    }
  }

  return Object.freeze({ reconcile, refresh });
}

export function createDebouncedFileWatcher({
  indexer,
  debounceMs = 500,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!indexer?.refresh) throw new TypeError('file_indexer_required');
  const timers = new Map();

  function notify(path) {
    if (timers.has(path)) clearTimer(timers.get(path));
    const timer = setTimer(async () => {
      timers.delete(path);
      await indexer.refresh(path);
    }, debounceMs);
    timers.set(path, timer);
  }

  function dispose() {
    for (const timer of timers.values()) clearTimer(timer);
    timers.clear();
  }

  return Object.freeze({ notify, dispose });
}
