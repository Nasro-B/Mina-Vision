import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../src/memory/database.mjs';
import { createEventRepository } from '../src/memory/event-repository.mjs';
import { createIdentityRepository } from '../src/memory/identity-repository.mjs';
import { createIdentityGraph } from '../src/memory/identity-graph.mjs';
import { createMemoryService } from '../src/memory/memory-service.mjs';
import { createShortTermMemory } from '../src/memory/short-term.mjs';
import { createConsolidator } from '../src/memory/consolidator.mjs';

let db;
let directory;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-service-'));
  db = openMemoryDatabase({ filename: join(directory, 'memory.sqlite'), securePermissions: () => {} });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

function createServices() {
  const encryptionKey = Buffer.alloc(32, 41);
  const indexKey = Buffer.alloc(32, 53);
  const eventRepository = createEventRepository({ db, encryptionKey, indexKey });
  const identityRepository = createIdentityRepository({ db, encryptionKey, indexKey });
  const identityGraph = createIdentityGraph({ identityRepository, idGenerator: () => 'generated-link' });
  const memory = createMemoryService({
    eventRepository,
    identityGraph,
    idGenerator: (() => { let id = 0; return () => `memory-${++id}`; })(),
    now: () => 1_700_000_000_000,
  });
  return { identityGraph, memory };
}

describe('short-term and consolidated memory', () => {
  it('bounds the working window by both event count and token estimate', () => {
    const shortTerm = createShortTermMemory({ maxEvents: 3, maxTokens: 6, estimateTokens: (text) => text.split(' ').length });
    shortTerm.add({ id: '1', content: 'un deux' });
    shortTerm.add({ id: '2', content: 'trois quatre' });
    shortTerm.add({ id: '3', content: 'cinq six' });
    shortTerm.add({ id: '4', content: 'sept huit neuf' });

    expect(shortTerm.list().map(({ id }) => id)).toEqual(['3', '4']);
    expect(shortTerm.tokenCount()).toBe(5);
  });

  it('creates a versioned projection traceable to every source without removing sources', async () => {
    const sources = [
      { id: 'event-1', content: 'Nasro préfère le français.' },
      { id: 'event-2', content: 'Mina répond directement.' },
    ];
    const consolidator = createConsolidator({
      summarize: async (events) => events.map(({ content }) => content).join(' '),
      idGenerator: () => 'summary-1',
      now: () => 10,
    });

    const projection = await consolidator.consolidate(sources);

    expect(projection).toEqual(expect.objectContaining({
      id: 'summary-1',
      version: 1,
      type: 'memory_summary',
      sourceEventIds: ['event-1', 'event-2'],
      createdAt: 10,
    }));
    expect(sources).toHaveLength(2);
  });
});

describe('unified cross-channel memory', () => {
  it('recalls an SMS from a local session after verified identity pairing', () => {
    const { identityGraph, memory } = createServices();
    identityGraph.registerOwner({ id: 'nasro', displayName: 'Nasro' });
    identityGraph.link({
      ownerId: 'nasro', kind: 'phone', value: '+33612345678',
      proof: { verified: true, method: 'local_pairing' },
    });

    memory.remember({
      kind: 'phone', value: '+33612345678', channel: 'sms',
      content: 'Le rendez-vous est mardi à 14h.', classification: 'normal',
      provenance: { messageId: 'sms-42', deviceId: 'huawei' },
    });
    const results = memory.recall({
      kind: 'local_owner', value: 'nasro', query: 'rendez-vous mardi',
    });

    expect(results[0]).toEqual(expect.objectContaining({
      content: 'Le rendez-vous est mardi à 14h.',
      classification: 'normal',
      date: 1_700_000_000_000,
      provenance: { messageId: 'sms-42', deviceId: 'huawei' },
      retention: 'indefinite',
    }));
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('masks secret and OTP memories unless local reveal is explicit', () => {
    const { identityGraph, memory } = createServices();
    identityGraph.registerOwner({ id: 'nasro', displayName: 'Nasro' });
    memory.remember({
      kind: 'local_owner', value: 'nasro', channel: 'local',
      content: 'OTP 739201', classification: 'otp', provenance: { source: 'screen' },
    });

    expect(memory.recall({ kind: 'local_owner', value: 'nasro', query: 'OTP' })[0].content).toBe('••••');
    expect(memory.recall({ kind: 'local_owner', value: 'nasro', query: 'OTP', revealSensitive: true })[0].content).toBe('OTP 739201');
  });

  it('ingests the same deterministic phone event only once', () => {
    const { identityGraph, memory } = createServices();
    identityGraph.registerOwner({ id: 'nasro', displayName: 'Nasro' });
    const eventId = `phone-${'a'.repeat(64)}`;
    const input = {
      eventId,
      kind: 'local_owner', value: 'nasro', channel: 'sms',
      content: 'Message durable', classification: 'sensitive',
      provenance: { messageId: 'opaque-1', deviceId: 'huawei-primary' },
    };

    const first = memory.remember(input);
    const duplicate = memory.remember(input);

    expect(duplicate).toEqual(first);
    expect(memory.recall({ kind: 'local_owner', value: 'nasro', query: 'Message', revealSensitive: true }))
      .toHaveLength(1);
  });

  it('rejects an unsafe externally supplied event id', () => {
    const { identityGraph, memory } = createServices();
    identityGraph.registerOwner({ id: 'nasro', displayName: 'Nasro' });

    expect(() => memory.remember({
      eventId: '../escape', kind: 'local_owner', value: 'nasro', channel: 'sms', content: 'x',
    })).toThrow('invalid_memory_event_id');
  });
});
