import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../../src/memory/database.mjs';
import { createEventRepository } from '../../src/memory/event-repository.mjs';
import { createIdentityRepository } from '../../src/memory/identity-repository.mjs';
import { createIdentityGraph } from '../../src/memory/identity-graph.mjs';
import { createMemoryService } from '../../src/memory/memory-service.mjs';
import { createForgetService } from '../../src/memory/forget-service.mjs';
import { createTombstoneRepository } from '../../src/memory/tombstone-repository.mjs';
import { createChannelRouter } from '../../src/messaging/channel-router.mjs';
import { createConversationService } from '../../src/messaging/conversation-service.mjs';

let db;
let directory;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-cross-channel-'));
  db = openMemoryDatabase({ filename: join(directory, 'memory.sqlite'), securePermissions: () => {} });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

function buildWorld() {
  const encryptionKey = Buffer.alloc(32, 41);
  const indexKey = Buffer.alloc(32, 53);
  const eventRepository = createEventRepository({ db, encryptionKey, indexKey });
  const identityRepository = createIdentityRepository({ db, encryptionKey, indexKey });
  const tombstoneRepository = createTombstoneRepository({ db, encryptionKey, indexKey });
  const identityGraph = createIdentityGraph({ identityRepository, idGenerator: (() => { let n = 0; return () => `link-${++n}`; })() });
  const memoryService = createMemoryService({
    eventRepository, identityGraph,
    idGenerator: (() => { let n = 0; return () => `event-${++n}`; })(),
    now: () => 1_700_000_000_000,
  });
  const router = createChannelRouter({ clock: () => 1_700_000_000_000 });
  const conversation = createConversationService({ memoryService, router, clock: () => 1_700_000_000_000 });
  const forgetService = createForgetService({
    db, eventRepository, tombstoneRepository, encryptionKey, indexKey,
    now: () => 1_700_000_000_000, idGenerator: (() => { let n = 0; return () => `tombstone-${++n}`; })(),
  });
  return { identityGraph, memoryService, conversation, forgetService };
}

describe('v2 integration: SMS memory consolidated and recalled from Telegram after owner linking', () => {
  it('a memory recorded via SMS is invisible from an unlinked Telegram identity, then recallable once linked', async () => {
    const { identityGraph, conversation } = buildWorld();
    identityGraph.registerOwner({ id: 'owner-1', displayName: 'Nasro' });

    identityGraph.link({ ownerId: 'owner-1', kind: 'phone', value: '+33600000000', proof: { verified: true, method: 'local_pairing' } });
    await conversation.ingest({ channel: 'sms', text: 'Rendez-vous dentiste jeudi 14h', identityValue: '+33600000000' });

    // Not yet linked: the identity graph has never heard of this Telegram id at all — recall fails
    // closed (an unresolved identity is an error, not an empty result; matches remember()'s own rule).
    expect(() => conversation.recallFor({ kind: 'telegram', value: '999888777', query: 'rendez-vous' })).toThrow('memory_identity_unresolved');

    // Real device-pairing proof links the same owner to their Telegram identity.
    identityGraph.link({ ownerId: 'owner-1', kind: 'telegram', value: '999888777', proof: { verified: true, method: 'device_pairing' } });
    const afterLink = conversation.recallFor({ kind: 'telegram', value: '999888777', query: 'rendez-vous' });
    expect(afterLink).toHaveLength(1);
    expect(afterLink[0].content).toBe('Rendez-vous dentiste jeudi 14h');

    // The same memory is also recallable directly from the original SMS identity (local recall).
    const local = conversation.recallFor({ kind: 'phone', value: '+33600000000', query: 'dentiste' });
    expect(local).toHaveLength(1);
  });

  it('rejects linking two different owners to the same phone number (no identity collision)', () => {
    const { identityGraph } = buildWorld();
    identityGraph.registerOwner({ id: 'owner-1', displayName: 'Nasro' });
    identityGraph.registerOwner({ id: 'owner-2', displayName: 'Autre' });
    identityGraph.link({ ownerId: 'owner-1', kind: 'phone', value: '+33600000000', proof: { verified: true, method: 'local_pairing' } });
    expect(() => identityGraph.link({ ownerId: 'owner-2', kind: 'phone', value: '+33600000000', proof: { verified: true, method: 'local_pairing' } }))
      .toThrow('identity_link_collision');
  });
});

describe('v2 integration: a remote /forget proposal never deletes before local confirmation', () => {
  it('a Telegram-originated forget request only proposes; the memory survives until confirmForget is called locally', async () => {
    const { identityGraph, conversation, forgetService } = buildWorld();
    identityGraph.registerOwner({ id: 'owner-1', displayName: 'Nasro' });
    identityGraph.link({ ownerId: 'owner-1', kind: 'telegram', value: '999888777', proof: { verified: true, method: 'device_pairing' } });
    const { event } = await conversation.ingest({ channel: 'telegram', text: 'Mon code est 4821', identityValue: '999888777' });

    // "Remote request" is only ever a proposal — nothing is deleted by proposeForget itself.
    const proposal = forgetService.proposeForget({ criteria: { eventId: event.id }, requester: 'telegram' });
    expect(proposal.status).toBe('awaiting_local_confirmation');
    const stillThere = conversation.recallFor({ kind: 'telegram', value: '999888777', query: 'code' });
    expect(stillThere).toHaveLength(1);

    // Only an explicit local confirmation actually deletes; confirming without confirmedLocally:true is refused.
    expect(() => forgetService.confirmForget({ proposalId: proposal.id })).toThrow('local_forget_confirmation_required');
    const confirmed = forgetService.confirmForget({ proposalId: proposal.id, confirmedLocally: true });
    expect(confirmed.deleted).toBeGreaterThan(0);
    const gone = conversation.recallFor({ kind: 'telegram', value: '999888777', query: 'code' });
    expect(gone).toEqual([]);
  });
});
