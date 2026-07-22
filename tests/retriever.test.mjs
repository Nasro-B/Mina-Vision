import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openMemoryDatabase } from '../src/memory/database.mjs';
import { createEventRepository } from '../src/memory/event-repository.mjs';
import { createVectorStore, rankVectorsExact } from '../src/rag/vector-store.mjs';
import { createRetriever } from '../src/rag/retriever.mjs';

const cleanups = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('encrypted vector store', () => {
  it('keeps the exact best top-K without sorting every candidate', () => {
    const ranked = rankVectorsExact({
      queryVector: new Float32Array([1, 0]),
      candidates: [
        { id: 'weak', vector: new Float32Array([0.2, 0.8]) },
        { id: 'best', vector: new Float32Array([1, 0]) },
        { id: 'middle', vector: new Float32Array([0.8, 0.2]) },
      ],
      limit: 2,
    });
    expect(ranked.map(({ id }) => id)).toEqual(['best', 'middle']);
  });

  it('stores Float32 vectors encrypted and ranks an exact candidate prefilter', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mina-vectors-'));
    cleanups.push(directory);
    const filename = join(directory, 'memory.sqlite');
    const db = openMemoryDatabase({ filename, securePermissions: () => {} });
    const encryptionKey = Buffer.alloc(32, 101);
    const events = createEventRepository({ db, encryptionKey, indexKey: Buffer.alloc(32, 103) });
    events.write({
      event: { id: 'event-v', version: 1, createdAt: 1, type: 'memory', identity: 'nasro', content: 'vectors' },
      chunks: [
        { id: 'chunk-a', ordinal: 0, content: 'a' },
        { id: 'chunk-b', ordinal: 1, content: 'b' },
      ],
    });
    const vectors = createVectorStore({ db, encryptionKey });
    vectors.put({ chunkId: 'chunk-a', vector: new Float32Array([1, 0]) });
    vectors.put({ chunkId: 'chunk-b', vector: new Float32Array([0.8, 0.2]) });

    expect(vectors.get('chunk-a')).toEqual(new Float32Array([1, 0]));
    expect(vectors.rankExact({
      queryVector: new Float32Array([0, 1]), candidateIds: ['chunk-a', 'chunk-b'],
    }).map(({ id }) => id)).toEqual(['chunk-b', 'chunk-a']);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    const raw = await readFile(filename);
    expect(raw.includes(Buffer.from(new Float32Array([1, 0]).buffer))).toBe(false);
  });
});

describe('hybrid retriever', () => {
  const candidates = [
    { id: 'a', score: 1, identity: 'nasro', date: 100, classification: 'normal', provenance: { eventId: 'a' } },
    { id: 'b', score: 0.8, identity: 'nasro', date: 200, classification: 'normal', provenance: { eventId: 'b' } },
    { id: 'other', score: 2, identity: 'other', date: 200, classification: 'normal', provenance: { eventId: 'other' } },
  ];

  it('combines lexical and vector scores, filters scope and preserves provenance', async () => {
    const lexicalSearch = vi.fn(async () => candidates);
    const retriever = createRetriever({
      lexicalSearch,
      embedder: { embed: async () => new Float32Array([0, 1]) },
      vectorStore: {
        rankExact: () => [{ id: 'b', score: 1 }, { id: 'a', score: 0 }],
      },
      lexicalWeight: 0.3,
      semanticWeight: 0.7,
    });

    const response = await retriever.search({ query: 'gâteau', filters: { identity: 'nasro', from: 50, to: 250 } });

    expect(response.status).toBe('ok');
    expect(response.results.map(({ id }) => id)).toEqual(['b', 'a']);
    expect(response.results[0].provenance).toEqual({ eventId: 'b' });
    expect(lexicalSearch).toHaveBeenCalledWith('gâteau', { identity: 'nasro', from: 50, to: 250 });
  });

  it('continues lexical-only and declares semantic degradation when the model is absent', async () => {
    const cloud = vi.fn();
    const retriever = createRetriever({
      lexicalSearch: async () => candidates.slice(0, 2),
      embedder: { embed: async () => { throw new Error('embedding_model_unavailable'); } },
      vectorStore: { rankExact: cloud },
    });

    const response = await retriever.search({ query: 'local', filters: {} });

    expect(response.status).toBe('semantic_degraded');
    expect(response.results.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(cloud).not.toHaveBeenCalled();
  });

  it('rejects a candidate without provenance', async () => {
    const retriever = createRetriever({
      lexicalSearch: async () => [{ id: 'unsafe', score: 1 }],
      embedder: null,
      vectorStore: null,
    });
    await expect(retriever.search({ query: 'x', filters: {} })).rejects.toThrow('rag_provenance_required');
  });
});
