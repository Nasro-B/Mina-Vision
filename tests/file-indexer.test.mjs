import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFilePolicy } from '../src/research/file-policy.mjs';
import { createFileReader } from '../src/research/file-reader.mjs';
import { createDebouncedFileWatcher, createFileIndexer } from '../src/research/file-indexer.mjs';

let root;
const cleanup = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mina-indexer-'));
  cleanup.push(root);
});

afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function setup(options = {}) {
  const policy = await createFilePolicy({ approvedRoots: [root] });
  const fileReader = createFileReader({ policy });
  const sink = {
    upsertFile: vi.fn(async () => {}),
    removeFile: vi.fn(async () => {}),
  };
  return { sink, indexer: createFileIndexer({ fileReader, sink, ...options }) };
}

describe('incremental local file indexer', () => {
  it('chunks with provenance, skips an unchanged digest and reindexes a modification', async () => {
    const path = join(root, 'source.txt');
    await writeFile(path, 'ligne 1\nligne 2\nligne 3', 'utf8');
    const { indexer, sink } = await setup({ chunkLines: 2 });

    expect(await indexer.reconcile([path])).toEqual({ indexed: 1, skipped: 0, removed: 0, bytes: 23 });
    expect(await indexer.reconcile([path])).toEqual({ indexed: 0, skipped: 1, removed: 0, bytes: 23 });
    await writeFile(path, 'ligne modifiée', 'utf8');
    expect((await indexer.reconcile([path])).indexed).toBe(1);

    const first = sink.upsertFile.mock.calls[0][0];
    expect(first.chunks).toEqual([
      expect.objectContaining({ path, lineStart: 1, lineEnd: 2, method: 'utf8_text' }),
      expect.objectContaining({ path, lineStart: 3, lineEnd: 3, method: 'utf8_text' }),
    ]);
    expect(sink.upsertFile).toHaveBeenCalledTimes(2);
  });

  it('removes derived chunks when a previously indexed file disappears', async () => {
    const path = join(root, 'gone.txt');
    await writeFile(path, 'temporaire', 'utf8');
    const { indexer, sink } = await setup();
    await indexer.reconcile([path]);

    expect(await indexer.reconcile([])).toEqual({ indexed: 0, skipped: 0, removed: 1, bytes: 0 });
    expect(sink.removeFile).toHaveBeenCalledWith(path);
  });

  it('enforces bounded job file and byte limits', async () => {
    const first = join(root, 'first.txt');
    const second = join(root, 'second.txt');
    await writeFile(first, '12345');
    await writeFile(second, '67890');

    await expect((await setup({ maxJobFiles: 1 })).indexer.reconcile([first, second]))
      .rejects.toThrow('file_job_count_limit');
    await expect((await setup({ maxJobBytes: 9 })).indexer.reconcile([first, second]))
      .rejects.toThrow('file_job_byte_limit');
  });

  it('debounces repeated watcher notifications for the same path', async () => {
    const callbacks = [];
    const indexer = { refresh: vi.fn(async () => {}) };
    const watcher = createDebouncedFileWatcher({
      indexer,
      debounceMs: 250,
      setTimer: (callback) => { callbacks.push(callback); return callbacks.length; },
      clearTimer: vi.fn(),
    });

    watcher.notify('C:/approved/file.txt');
    watcher.notify('C:/approved/file.txt');
    await callbacks.at(-1)();

    expect(indexer.refresh).toHaveBeenCalledTimes(1);
    expect(indexer.refresh).toHaveBeenCalledWith('C:/approved/file.txt');
  });
});
