import { describe, expect, it, vi } from 'vitest';
import { createDocumentQuarantineStore } from '../src/documents/document-quarantine.mjs';

function fakeFilesystem() {
  const files = new Map();
  return {
    files,
    writeFile: vi.fn(async (path, bytes) => { files.set(path, bytes); }),
    readFile: vi.fn(async (path) => { if (!files.has(path)) throw new Error('ENOENT'); return files.get(path); }),
    rm: vi.fn(async (path) => { files.delete(path); }),
  };
}

function fakeRepository() {
  const rows = new Map();
  return {
    put: vi.fn(async (id, record) => { rows.set(id, record); }),
    get: vi.fn(async (id) => rows.get(id) ?? null),
    list: vi.fn(async () => [...rows.values()]),
    delete: vi.fn(async (id) => rows.delete(id)),
  };
}

function validItem(overrides = {}) {
  return {
    documentId: 'd1', digest: `sha256:${'a'.repeat(64)}`, source: 'upload', declaredName: 'facture.pdf',
    detectedType: 'application/pdf', size: 100, status: 'inspectable', reasons: [], observedAt: '2026-07-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('createDocumentQuarantineStore: constructor guards', () => {
  it('requires a filesystem', () => {
    expect(() => createDocumentQuarantineStore({ repository: fakeRepository() })).toThrow('document_quarantine_filesystem_required');
  });

  it('requires a repository', () => {
    expect(() => createDocumentQuarantineStore({ filesystem: fakeFilesystem() })).toThrow('document_quarantine_repository_required');
  });
});

describe('createDocumentQuarantineStore: writeBytes / readBytes', () => {
  it('writes bytes under the quarantine directory with a restrictive mode, no extension', async () => {
    const filesystem = fakeFilesystem();
    const store = createDocumentQuarantineStore({ filesystem, repository: fakeRepository() });
    const path = await store.writeBytes('d1', Buffer.from('hello'));
    expect(path).toBe('quarantine/d1');
    expect(filesystem.writeFile).toHaveBeenCalledWith('quarantine/d1', Buffer.from('hello'), expect.objectContaining({ mode: 0o600 }));
  });

  it('reads back written bytes', async () => {
    const filesystem = fakeFilesystem();
    const store = createDocumentQuarantineStore({ filesystem, repository: fakeRepository() });
    await store.writeBytes('d1', Buffer.from('hello'));
    expect(await store.readBytes('d1')).toEqual(Buffer.from('hello'));
  });

  it('encrypts quarantined source bytes when an encryption key provider is configured', async () => {
    const filesystem = fakeFilesystem();
    const plaintext = Buffer.from('facture sensible mina');
    const store = createDocumentQuarantineStore({
      filesystem,
      repository: fakeRepository(),
      getEncryptionKey: () => Buffer.alloc(32, 7),
    });

    await store.writeBytes('d1', plaintext);
    const stored = filesystem.files.get('quarantine/d1');

    expect(stored).not.toEqual(plaintext);
    expect(Buffer.from(stored).toString('utf8')).not.toContain('facture sensible mina');
    expect(await store.readBytes('d1')).toEqual(Buffer.from('facture sensible mina'));
  });

  it('fails closed when encryption is configured but the key is unavailable', async () => {
    const filesystem = fakeFilesystem();
    const store = createDocumentQuarantineStore({
      filesystem,
      repository: fakeRepository(),
      getEncryptionKey: () => null,
    });

    await expect(store.writeBytes('d1', Buffer.from('secret'))).rejects.toThrow('document_quarantine_encryption_key_required');
    expect(filesystem.writeFile).not.toHaveBeenCalled();
  });

  it('reads legacy raw source files even after encryption is configured', async () => {
    const filesystem = fakeFilesystem();
    filesystem.files.set('quarantine/d1', Buffer.from('legacy raw bytes'));
    const store = createDocumentQuarantineStore({
      filesystem,
      repository: fakeRepository(),
      getEncryptionKey: () => Buffer.alloc(32, 7),
    });

    expect(await store.readBytes('d1')).toEqual(Buffer.from('legacy raw bytes'));
  });
});

describe('createDocumentQuarantineStore: putRecord / getRecord / listRecords', () => {
  it('validates and persists a record', async () => {
    const store = createDocumentQuarantineStore({ filesystem: fakeFilesystem(), repository: fakeRepository() });
    const record = await store.putRecord(validItem());
    expect(record.status).toBe('inspectable');
    expect(Object.isFrozen(record)).toBe(true);
  });

  it('rejects an invalid record shape', async () => {
    const store = createDocumentQuarantineStore({ filesystem: fakeFilesystem(), repository: fakeRepository() });
    await expect(store.putRecord({ ...validItem(), status: 'unknown-status' })).rejects.toThrow();
  });

  it('getRecord returns null for an unknown id', async () => {
    const store = createDocumentQuarantineStore({ filesystem: fakeFilesystem(), repository: fakeRepository() });
    expect(await store.getRecord('missing')).toBeNull();
  });

  it('listRecords lists every persisted record', async () => {
    const store = createDocumentQuarantineStore({ filesystem: fakeFilesystem(), repository: fakeRepository() });
    await store.putRecord(validItem({ documentId: 'd1' }));
    await store.putRecord(validItem({ documentId: 'd2', digest: `sha256:${'b'.repeat(64)}` }));
    expect(await store.listRecords()).toHaveLength(2);
  });
});

describe('createDocumentQuarantineStore.findByDigest', () => {
  it('finds an existing record by digest', async () => {
    const store = createDocumentQuarantineStore({ filesystem: fakeFilesystem(), repository: fakeRepository() });
    const record = await store.putRecord(validItem());
    expect(await store.findByDigest(record.digest)).toEqual(record);
  });

  it('returns null when no record matches the digest', async () => {
    const store = createDocumentQuarantineStore({ filesystem: fakeFilesystem(), repository: fakeRepository() });
    expect(await store.findByDigest(`sha256:${'c'.repeat(64)}`)).toBeNull();
  });
});

describe('createDocumentQuarantineStore: deleteBytes / deleteRecord', () => {
  it('deletes only the targeted quarantined byte file', async () => {
    const filesystem = fakeFilesystem();
    const store = createDocumentQuarantineStore({ filesystem, repository: fakeRepository() });
    await store.writeBytes('d1', Buffer.from('hello'));
    await store.writeBytes('d2', Buffer.from('other'));
    await expect(store.deleteBytes('d1')).resolves.toBe(true);
    await expect(store.readBytes('d1')).rejects.toThrow('ENOENT');
    await expect(store.readBytes('d2')).resolves.toEqual(Buffer.from('other'));
    expect(filesystem.rm).toHaveBeenCalledWith('quarantine/d1', expect.objectContaining({ force: true }));
  });

  it('deletes only the targeted quarantine metadata record', async () => {
    const repository = fakeRepository();
    const store = createDocumentQuarantineStore({ filesystem: fakeFilesystem(), repository });
    await store.putRecord(validItem({ documentId: 'd1' }));
    await store.putRecord(validItem({ documentId: 'd2', digest: `sha256:${'b'.repeat(64)}` }));
    await expect(store.deleteRecord('d1')).resolves.toBe(true);
    await expect(store.getRecord('d1')).resolves.toBeNull();
    await expect(store.getRecord('d2')).resolves.toMatchObject({ documentId: 'd2' });
  });
});
