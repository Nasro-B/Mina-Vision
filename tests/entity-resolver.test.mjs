import { describe, expect, it, vi } from 'vitest';
import { createEntityResolver } from '../src/graph/entity-resolver.mjs';

function fakeRepository(byField = {}) {
  return {
    findByAttribute: vi.fn(async (field, value) => (byField[field]?.[value] ?? [])),
  };
}

describe('createEntityResolver: constructor guards', () => {
  it('requires a repository', () => {
    expect(() => createEntityResolver({})).toThrow('entity_resolver_repository_required');
  });
});

describe('createEntityResolver.resolve: name alone is never sufficient for an exact match', () => {
  it('resolves ambiguous when a bare name matches an existing entity (never fuses on name alone)', async () => {
    const repository = fakeRepository({ name: { Mohamed: [{ entityId: 'p1' }] } });
    const resolver = createEntityResolver({ repository });
    const result = await resolver.resolve({ name: 'Mohamed', email: null });
    expect(result.status).toBe('ambiguous');
  });

  it('resolves ambiguous when a bare name matches multiple existing entities', async () => {
    const repository = fakeRepository({ name: { Mohamed: [{ entityId: 'p1' }, { entityId: 'p2' }] } });
    const resolver = createEntityResolver({ repository });
    const result = await resolver.resolve({ name: 'Mohamed' });
    expect(result).toMatchObject({ status: 'ambiguous', candidates: ['p1', 'p2'] });
  });

  it('resolves new when nothing matches at all', async () => {
    const repository = fakeRepository({});
    const resolver = createEntityResolver({ repository });
    expect(await resolver.resolve({ name: 'Personne Inconnue' })).toEqual({ status: 'new' });
  });
});

describe('createEntityResolver.resolve: strong identifiers (email/phone) can resolve exactly', () => {
  it('resolves exact on a unique email match', async () => {
    const repository = fakeRepository({ email: { 'alice@example.com': [{ entityId: 'p1' }] } });
    const resolver = createEntityResolver({ repository });
    expect(await resolver.resolve({ email: 'alice@example.com' })).toEqual({ status: 'exact', entityId: 'p1' });
  });

  it('resolves ambiguous when an email matches more than one entity', async () => {
    const repository = fakeRepository({ email: { 'shared@example.com': [{ entityId: 'p1' }, { entityId: 'p2' }] } });
    const resolver = createEntityResolver({ repository });
    const result = await resolver.resolve({ email: 'shared@example.com' });
    expect(result.status).toBe('ambiguous');
  });

  it('resolves exact on a unique phone match', async () => {
    const repository = fakeRepository({ phone: { '+33600000000': [{ entityId: 'p1' }] } });
    const resolver = createEntityResolver({ repository });
    expect(await resolver.resolve({ phone: '+33600000000' })).toEqual({ status: 'exact', entityId: 'p1' });
  });

  it('prefers email over phone when both are provided and email resolves exactly', async () => {
    const repository = fakeRepository({
      email: { 'alice@example.com': [{ entityId: 'p1' }] },
      phone: { '+33600000000': [{ entityId: 'p2' }] },
    });
    const resolver = createEntityResolver({ repository });
    expect(await resolver.resolve({ email: 'alice@example.com', phone: '+33600000000' })).toEqual({ status: 'exact', entityId: 'p1' });
  });

  it('does not fall through to a name check once a strong identifier already resolved', async () => {
    const repository = fakeRepository({ email: { 'alice@example.com': [{ entityId: 'p1' }] }, name: { Alice: [{ entityId: 'p2' }] } });
    const resolver = createEntityResolver({ repository });
    const result = await resolver.resolve({ name: 'Alice', email: 'alice@example.com' });
    expect(result).toEqual({ status: 'exact', entityId: 'p1' });
  });
});
