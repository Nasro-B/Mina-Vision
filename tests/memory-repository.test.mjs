import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../src/memory/database.mjs';
import { createEventRepository } from '../src/memory/event-repository.mjs';
import { createIdentityRepository } from '../src/memory/identity-repository.mjs';
import { createTombstoneRepository } from '../src/memory/tombstone-repository.mjs';

const SECRET = 'MINA_SECRET_FIXTURE_7c62c978';
let db;
let directory;
let filename;
let eventRepository;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-repository-'));
  filename = join(directory, 'memory.sqlite');
  db = openMemoryDatabase({ filename, securePermissions: () => {} });
  eventRepository = createEventRepository({
    db,
    encryptionKey: Buffer.alloc(32, 17),
    indexKey: Buffer.alloc(32, 29),
  });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

describe('encrypted memory event repository', () => {
  it('atomically writes and authenticates an event with its chunks', () => {
    eventRepository.write({
      event: {
        id: 'event-1',
        version: 1,
        createdAt: 1_700_000_000_000,
        type: 'sms',
        identity: '+33600000000',
        channel: 'phone',
        source: 'device-huawei',
        content: SECRET,
      },
      chunks: [{ id: 'chunk-1', ordinal: 0, content: `chunk ${SECRET}` }],
    });

    const restored = eventRepository.read('event-1');
    expect(restored.event.content).toBe(SECRET);
    expect(restored.event.identity).toBe('+33600000000');
    expect(restored.chunks).toEqual([{ id: 'chunk-1', ordinal: 0, content: `chunk ${SECRET}` }]);
    expect(() => eventRepository.write({
      event: { id: 'event-1', version: 1, createdAt: 2, type: 'sms', content: 'duplicate' },
      chunks: [],
    })).toThrow();
  });

  it('rolls back the event when one chunk violates a constraint', () => {
    expect(() => eventRepository.write({
      event: { id: 'event-rollback', version: 1, createdAt: 3, type: 'note', content: SECRET },
      chunks: [
        { id: 'same-chunk', ordinal: 0, content: 'first' },
        { id: 'same-chunk', ordinal: 1, content: 'second' },
      ],
    })).toThrow();

    expect(eventRepository.read('event-rollback')).toBeNull();
  });

  it('stores no plaintext content, phone, channel, source or token column', async () => {
    eventRepository.write({
      event: {
        id: 'event-secret-scan', version: 1, createdAt: 4, type: 'sms',
        identity: '+33611112222', channel: 'telegram', source: 'samsung', content: SECRET,
      },
      chunks: [{ id: 'chunk-secret-scan', ordinal: 0, content: SECRET }],
    });
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();

    const raw = await readFile(filename);
    for (const marker of [SECRET, '+33611112222', 'telegram', 'samsung']) {
      expect(raw.includes(Buffer.from(marker))).toBe(false);
    }

    db = openMemoryDatabase({ filename, securePermissions: () => {} });
    for (const table of ['memory_events', 'memory_chunks', 'identities', 'identity_links']) {
      const columns = db.pragma(`table_info(${table})`).map(({ name }) => name);
      expect(columns).not.toEqual(expect.arrayContaining([
        'content', 'phone', 'number', 'channel', 'source', 'token', 'email',
      ]));
    }
  });
});

describe('encrypted identity and tombstone repositories', () => {
  it('resolves a verified link without persisting its plaintext value', () => {
    const identities = createIdentityRepository({
      db,
      encryptionKey: Buffer.alloc(32, 17),
      indexKey: Buffer.alloc(32, 29),
    });
    identities.writeIdentity({ id: 'owner', displayName: 'Nasro' });
    identities.link({ id: 'link-1', identityId: 'owner', kind: 'phone', value: '+33699998888', verifiedAt: 5 });

    expect(identities.findByLink({ kind: 'phone', value: '+33699998888' })).toEqual({
      id: 'owner',
      displayName: 'Nasro',
    });
  });

  it('creates and reads an encrypted tombstone by a blind target hash', () => {
    const tombstones = createTombstoneRepository({
      db,
      encryptionKey: Buffer.alloc(32, 17),
      indexKey: Buffer.alloc(32, 29),
    });
    tombstones.write({ id: 'tombstone-1', target: 'event:event-1', createdAt: 6, reason: SECRET });

    expect(tombstones.findByTarget('event:event-1')).toEqual({
      id: 'tombstone-1', target: 'event:event-1', createdAt: 6, reason: SECRET,
    });
  });
});
