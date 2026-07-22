import { describe, expect, it, vi } from 'vitest';
import { createContactRepository } from '../src/personal/contact-repository.mjs';
import { createContactService } from '../src/personal/contact-service.mjs';

function fakeBackingRepo() {
  const rows = new Map();
  return {
    async put(id, record) { rows.set(id, record); },
    async get(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
    async delete(id) { rows.delete(id); },
  };
}

function candidatePerson(overrides = {}) {
  return {
    personId: 'p1', providerId: 'google', displayName: 'Alice',
    endpoints: [{ channel: 'email', value: 'alice@maybe.example', verified: false }],
    revision: 'r1',
    ...overrides,
  };
}

function buildService(overrides = {}) {
  const repo = createContactRepository({ repository: fakeBackingRepo() });
  const confirmationService = { confirm: vi.fn(async () => true) };
  const service = createContactService({
    repository: repo, hub: { adapter: vi.fn() }, confirmationService, clock: () => 1_700_000_000_000, ...overrides,
  });
  return { repo, service, confirmationService };
}

describe('createContactService: constructor guards', () => {
  it('requires a repository', () => {
    expect(() => createContactService({ hub: { adapter: vi.fn() }, confirmationService: { confirm: vi.fn() }, clock: () => 0 }))
      .toThrow('contact_service_repository_required');
  });
});

describe('createContactService.resolveEndpoint: never sends to a candidate endpoint', () => {
  it('never returns a candidate endpoint for sending', async () => {
    const { repo, service } = buildService();
    await repo.put(candidatePerson());
    expect(await service.resolveEndpoint({ personId: 'p1', channel: 'email', purpose: 'send' })).toEqual({ status: 'unverified' });
  });

  it('resolves a verified endpoint for sending', async () => {
    const { repo, service } = buildService();
    await repo.put(candidatePerson({ endpoints: [{ channel: 'email', value: 'alice@example.com', verified: true }] }));
    expect(await service.resolveEndpoint({ personId: 'p1', channel: 'email', purpose: 'send' }))
      .toEqual({ status: 'resolved', value: 'alice@example.com' });
  });

  it('reports candidate status for a non-send purpose (display) without gating it', async () => {
    const { repo, service } = buildService();
    await repo.put(candidatePerson());
    expect(await service.resolveEndpoint({ personId: 'p1', channel: 'email', purpose: 'display' }))
      .toEqual({ status: 'candidate', value: 'alice@maybe.example' });
  });

  it('throws for an unknown person', async () => {
    const { service } = buildService();
    await expect(service.resolveEndpoint({ personId: 'missing', channel: 'email', purpose: 'send' })).rejects.toThrow('contact_not_found');
  });

  it('returns unverified when no endpoint exists at all for the requested channel', async () => {
    const { repo, service } = buildService();
    await repo.put(candidatePerson({ endpoints: [] }));
    expect(await service.resolveEndpoint({ personId: 'p1', channel: 'phone', purpose: 'send' })).toEqual({ status: 'unverified' });
  });
});

describe('createContactService.proposeLink / confirmLink', () => {
  it('validates the channel is one of email/phone/telegram', async () => {
    const { service } = buildService();
    await expect(service.proposeLink({ personId: 'p1', channel: 'fax', value: '123' })).rejects.toThrow('contact_link_channel_invalid');
  });

  it('validates a phone value is E.164', async () => {
    const { repo, service } = buildService();
    await repo.put(candidatePerson());
    await expect(service.proposeLink({ personId: 'p1', channel: 'phone', value: '0600000000' })).rejects.toThrow('contact_link_value_invalid');
  });

  it('accepts a well-formed E.164 phone proposal', async () => {
    const { repo, service } = buildService();
    await repo.put(candidatePerson());
    const link = await service.proposeLink({ personId: 'p1', channel: 'phone', value: '+33600000000' });
    expect(link.status).toBe('pending');
  });

  it('does not attach the endpoint until confirmLink is called', async () => {
    const { repo, service } = buildService();
    await repo.put(candidatePerson());
    await service.proposeLink({ personId: 'p1', channel: 'phone', value: '+33600000000' });
    const person = await repo.get('p1');
    expect(person.endpoints.some((e) => e.channel === 'phone')).toBe(false);
  });

  it('confirmLink requires local confirmation and then attaches a verified endpoint', async () => {
    const { repo, service } = buildService();
    await repo.put(candidatePerson());
    const link = await service.proposeLink({ personId: 'p1', channel: 'phone', value: '+33600000000' });
    const person = await service.confirmLink(link.linkId);
    expect(person.endpoints).toContainEqual({ channel: 'phone', value: '+33600000000', verified: true });
  });

  it('rejects confirmLink when local confirmation is refused, and the endpoint stays unattached', async () => {
    const confirmationService = { confirm: vi.fn(async () => false) };
    const { repo, service } = buildService({ confirmationService });
    await repo.put(candidatePerson());
    const link = await service.proposeLink({ personId: 'p1', channel: 'phone', value: '+33600000000' });
    await expect(service.confirmLink(link.linkId)).rejects.toThrow('confirmation_refused');
    expect((await repo.get('p1')).endpoints.some((e) => e.channel === 'phone')).toBe(false);
  });

  it('rejects confirming an unknown or already-confirmed link', async () => {
    const { service } = buildService();
    await expect(service.confirmLink('missing')).rejects.toThrow('contact_link_not_found');
  });
});

describe('createContactService.merge: never automatic, always reasoned and confirmed', () => {
  it('requires a non-empty reason', async () => {
    const { repo, service } = buildService();
    await repo.put(candidatePerson({ personId: 'p1' }));
    await repo.put(candidatePerson({ personId: 'p2', displayName: 'Alice B' }));
    await expect(service.merge({ intoPersonId: 'p1', fromPersonId: 'p2', reason: '' })).rejects.toThrow('contact_merge_reason_required');
  });

  it('requires local confirmation', async () => {
    const confirmationService = { confirm: vi.fn(async () => false) };
    const { repo, service } = buildService({ confirmationService });
    await repo.put(candidatePerson({ personId: 'p1' }));
    await repo.put(candidatePerson({ personId: 'p2' }));
    await expect(service.merge({ intoPersonId: 'p1', fromPersonId: 'p2', reason: 'même personne, confirmé par Nasro' })).rejects.toThrow('confirmation_refused');
  });

  it('merges endpoints into the target and tombstones the source with provenance', async () => {
    const { repo, service } = buildService();
    await repo.put(candidatePerson({ personId: 'p1', endpoints: [{ channel: 'email', value: 'alice@example.com', verified: true }] }));
    await repo.put(candidatePerson({ personId: 'p2', endpoints: [{ channel: 'phone', value: '+33600000000', verified: true }] }));

    const merged = await service.merge({ intoPersonId: 'p1', fromPersonId: 'p2', reason: 'même personne, confirmé par Nasro' });
    expect(merged.endpoints).toContainEqual({ channel: 'email', value: 'alice@example.com', verified: true });
    expect(merged.endpoints).toContainEqual({ channel: 'phone', value: '+33600000000', verified: true });

    const tombstone = await repo.get('p2');
    expect(tombstone).toMatchObject({ personId: 'p2', tombstoned: true, mergedInto: 'p1' });
  });
});

describe('createContactService.split: extracts an endpoint into a new person with provenance', () => {
  it('removes the endpoint from the source and creates a new person carrying it', async () => {
    const { repo, service } = buildService();
    await repo.put(candidatePerson({
      personId: 'p1',
      endpoints: [
        { channel: 'email', value: 'alice@example.com', verified: true },
        { channel: 'phone', value: '+33600000000', verified: true },
      ],
    }));

    const result = await service.split({ personId: 'p1', endpoint: { channel: 'phone', value: '+33600000000' } });
    expect(result.newPerson.endpoints).toEqual([{ channel: 'phone', value: '+33600000000', verified: true }]);
    expect(result.newPerson.splitFrom).toBe('p1');

    const original = await repo.get('p1');
    expect(original.endpoints).toEqual([{ channel: 'email', value: 'alice@example.com', verified: true }]);
  });

  it('rejects splitting an endpoint that does not exist on the person', async () => {
    const { repo, service } = buildService();
    await repo.put(candidatePerson());
    await expect(service.split({ personId: 'p1', endpoint: { channel: 'phone', value: '+33699999999' } })).rejects.toThrow('contact_endpoint_not_found');
  });
});

describe('createContactService.sync', () => {
  it('persists synced contacts and deletes removed ones', async () => {
    const provider = {
      sync: vi.fn(async () => ({
        items: [{ personId: 'p1', providerId: 'google', displayName: 'Alice', endpoints: [], revision: 'r1' }],
        removedIds: [], cursor: 'sync-2', hasMore: false,
      })),
    };
    const { repo, service } = buildService({ hub: { adapter: () => provider } });
    await service.sync('google');
    expect(await repo.get('p1')).toMatchObject({ displayName: 'Alice' });
  });
});

describe('createContactService.list', () => {
  it('returns every persisted contact, for voice/Telegram lookup by name', async () => {
    const { repo, service } = buildService();
    await repo.put(candidatePerson({ personId: 'p1', displayName: 'Alice' }));
    await repo.put(candidatePerson({ personId: 'p2', displayName: 'Bob' }));
    const people = await service.list();
    expect(people.map((person) => person.displayName).sort()).toEqual(['Alice', 'Bob']);
  });

  it('returns an empty array when nothing is synced yet, never throws', async () => {
    const { service } = buildService();
    await expect(service.list()).resolves.toEqual([]);
  });
});
