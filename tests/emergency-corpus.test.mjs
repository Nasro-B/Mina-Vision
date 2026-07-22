import { describe, expect, it, vi } from 'vitest';
import { createEmergencyCorpus } from '../src/emergency/emergency-corpus.mjs';

function fakeKeyring(key = Buffer.alloc(32, 7)) {
  return { open: vi.fn(async () => key) };
}

function fakeFilesystem() {
  const files = new Map();
  return { files, writeFile: vi.fn(async (path, bytes) => files.set(path, bytes)), readFile: vi.fn(async (path) => files.get(path)) };
}

function contactsExporter() {
  return {
    sourceId: 'contacts',
    export: vi.fn(async (itemIds) => itemIds.map((id) => ({ itemId: id, classification: 'sensitive', payload: { name: 'Alice', phone: '+33600000000' } }))),
  };
}

function buildWorld() {
  const keyring = fakeKeyring();
  const filesystem = fakeFilesystem();
  const corpus = createEmergencyCorpus({ keyring, exporters: [contactsExporter()], filesystem, clock: () => 1_700_000_000_000 });
  return { corpus, keyring, filesystem };
}

describe('createEmergencyCorpus: constructor guards', () => {
  it('requires a keyring', () => {
    expect(() => createEmergencyCorpus({ exporters: [contactsExporter()], filesystem: fakeFilesystem(), clock: () => 0 }))
      .toThrow('emergency_corpus_keyring_required');
  });

  it('requires at least one exporter', () => {
    expect(() => createEmergencyCorpus({ keyring: fakeKeyring(), exporters: [], filesystem: fakeFilesystem(), clock: () => 0 }))
      .toThrow('emergency_corpus_exporters_required');
  });
});

describe('createEmergencyCorpus.build: manifest with digest/version/classification/observedAt', () => {
  it('builds a bundle whose manifest carries the documented fields', async () => {
    const { corpus, filesystem } = buildWorld();
    const result = await corpus.build([{ sourceId: 'contacts', itemIds: ['c1'] }]);
    expect(result.itemCount).toBe(1);
    expect(filesystem.files.has(result.path)).toBe(true);

    const bundle = await corpus.verify(result.path);
    expect(bundle.manifest[0]).toMatchObject({ itemId: 'c1', sourceId: 'contacts', classification: 'sensitive', version: 1, observedAt: '2023-11-14T22:13:20.000Z' });
    expect(bundle.manifest[0].digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('rejects a selection referencing an unknown source', async () => {
    const { corpus } = buildWorld();
    await expect(corpus.build([{ sourceId: 'unknown', itemIds: ['x'] }])).rejects.toThrow('emergency_corpus_exporter_not_found:unknown');
  });
});

describe('createEmergencyCorpus.verify: real AEAD, tamper detected', () => {
  it('verifies a genuinely built bundle successfully', async () => {
    const { corpus } = buildWorld();
    const result = await corpus.build([{ sourceId: 'contacts', itemIds: ['c1'] }]);
    await expect(corpus.verify(result.path)).resolves.toMatchObject({ bundleId: result.bundleId });
  });

  it('rejects a tampered bundle (flipped ciphertext byte) with emergency_manifest_invalid', async () => {
    const { corpus, filesystem } = buildWorld();
    const result = await corpus.build([{ sourceId: 'contacts', itemIds: ['c1'] }]);
    const original = filesystem.files.get(result.path);
    const envelope = JSON.parse(original.toString('utf8'));
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    ciphertext[0] ^= 0xff;
    envelope.ciphertext = ciphertext.toString('base64');
    filesystem.files.set(result.path, Buffer.from(JSON.stringify(envelope)));

    await expect(corpus.verify(result.path)).rejects.toThrow('emergency_manifest_invalid');
  });

  it('rejects a bundle sealed with a different key (wrong keyring)', async () => {
    const { corpus, filesystem } = buildWorld();
    const result = await corpus.build([{ sourceId: 'contacts', itemIds: ['c1'] }]);
    const otherKeyring = fakeKeyring(Buffer.alloc(32, 9));
    const otherCorpus = createEmergencyCorpus({ keyring: otherKeyring, exporters: [contactsExporter()], filesystem, clock: () => 0 });
    await expect(otherCorpus.verify(result.path)).rejects.toThrow('emergency_manifest_invalid');
  });

  it('rejects garbage bytes that are not a valid envelope at all', async () => {
    const { corpus, filesystem } = buildWorld();
    filesystem.files.set('junk.bin', Buffer.from('not json'));
    await expect(corpus.verify('junk.bin')).rejects.toThrow('emergency_manifest_invalid');
  });
});
