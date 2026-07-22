import { describe, expect, it } from 'vitest';
import { createJsonRepository } from '../src/documents/document-repository.mjs';

describe('createJsonRepository', () => {
  it('rejects an invalid table name (SQL-identifier safety)', () => {
    expect(() => createJsonRepository({ filename: ':memory:', table: 'bad; drop table' })).toThrow(TypeError);
  });

  it('put/get/list round-trip a JSON record', async () => {
    const repository = createJsonRepository({ filename: ':memory:', table: 'printers' });
    await repository.put('p1', { printerId: 'p1', approved: true });
    await expect(repository.get('p1')).resolves.toEqual({ printerId: 'p1', approved: true });
    await expect(repository.list()).resolves.toEqual([{ printerId: 'p1', approved: true }]);
  });

  it('get() on an unknown id returns null', async () => {
    const repository = createJsonRepository({ filename: ':memory:', table: 'printers' });
    await expect(repository.get('missing')).resolves.toBeNull();
  });

  it('put() upserts — a second write with the same id replaces the record', async () => {
    const repository = createJsonRepository({ filename: ':memory:', table: 'printers' });
    await repository.put('p1', { approved: false });
    await repository.put('p1', { approved: true });
    await expect(repository.get('p1')).resolves.toEqual({ approved: true });
    await expect(repository.list()).resolves.toHaveLength(1);
  });

  it('two different tables in the same file stay isolated', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory = await mkdtemp(join(tmpdir(), 'mina-json-repo-'));
    try {
      const filename = join(directory, 'shared.sqlite');
      const printers = createJsonRepository({ filename, table: 'printers' });
      const documents = createJsonRepository({ filename, table: 'documents' });
      await printers.put('x', { kind: 'printer' });
      await documents.put('x', { kind: 'document' });
      await expect(printers.get('x')).resolves.toEqual({ kind: 'printer' });
      await expect(documents.get('x')).resolves.toEqual({ kind: 'document' });
      printers.close();
      documents.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
