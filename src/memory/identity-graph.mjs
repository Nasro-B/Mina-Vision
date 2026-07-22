import { randomUUID } from 'node:crypto';

const PAIRING_METHODS = new Set(['local_pairing', 'device_pairing']);

function linkKey(kind, value) {
  return `${String(kind).normalize('NFKC')}\0${String(value).normalize('NFKC').trim()}`;
}

export function createIdentityGraph({ identityRepository, idGenerator = randomUUID } = {}) {
  const owners = new Map();
  const links = new Map();

  function registerOwner(owner) {
    if (!owner?.id) throw new TypeError('invalid_identity_owner');
    if (owners.has(owner.id)) throw new Error('identity_owner_exists');
    const stored = structuredClone(owner);
    identityRepository?.writeIdentity(stored);
    owners.set(owner.id, stored);
    return structuredClone(stored);
  }

  function getOwner(ownerId) {
    return owners.get(ownerId) ?? identityRepository?.readIdentity?.(ownerId) ?? null;
  }

  function resolve({ kind, value } = {}) {
    if (!kind || !value) return null;
    if (kind === 'local_owner') {
      const owner = getOwner(value);
      return owner ? structuredClone(owner) : null;
    }
    const memoryMatch = links.get(linkKey(kind, value));
    if (memoryMatch) return structuredClone(getOwner(memoryMatch));
    return identityRepository?.findByLink?.({ kind, value }) ?? null;
  }

  function link({ ownerId, kind, value, proof } = {}) {
    if (!getOwner(ownerId)) throw new Error('identity_owner_not_found');
    if (!kind || kind === 'local_owner' || !value) throw new TypeError('invalid_identity_link');
    if (proof?.verified !== true || !PAIRING_METHODS.has(proof.method)) {
      throw new Error('identity_pairing_proof_required');
    }
    const existing = resolve({ kind, value });
    if (existing && existing.id !== ownerId) throw new Error('identity_link_collision');
    if (existing) return existing;

    const id = idGenerator();
    const verifiedAt = Number.isFinite(proof.verifiedAt) ? proof.verifiedAt : Date.now();
    identityRepository?.link({ id, identityId: ownerId, kind, value, proof, verifiedAt });
    links.set(linkKey(kind, value), ownerId);
    return structuredClone(getOwner(ownerId));
  }

  return Object.freeze({ registerOwner, link, resolve });
}
