import { createHash, verify as cryptoVerify } from 'node:crypto';

export function fingerprintPublicKey(publicKey) {
  return `sha256:${createHash('sha256').update(String(publicKey), 'utf8').digest('hex')}`;
}

export function createPublisherTrustStore({ repository, clock } = {}) {
  if (!repository?.put || !repository?.get) throw new TypeError('publisher_trust_store_repository_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('publisher_trust_store_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    async approvePublisher({ publisherId, fingerprint, publicKey }) {
      if (typeof publisherId !== 'string' || publisherId.length === 0) throw new TypeError('publisher_id_required');
      if (typeof fingerprint !== 'string' || fingerprint.length === 0) throw new TypeError('publisher_fingerprint_required');
      const record = Object.freeze({
        publisherId, fingerprint, publicKey: publicKey ?? null, approvedAt: new Date(now()).toISOString(), revoked: false, revokedAt: null,
      });
      await repository.put(publisherId, record);
      return record;
    },

    async isApproved(publisherId) {
      const record = await repository.get(publisherId);
      return Boolean(record) && !record.revoked;
    },

    // Marks a previously-approved publisher as revoked. Does not erase the trust record (audit
    // trail of when/who was once approved is kept); isApproved() flips to false immediately after.
    async revokePublisher(publisherId) {
      const record = await repository.get(publisherId);
      if (!record) throw new Error('publisher_not_found');
      const revoked = Object.freeze({ ...record, revoked: true, revokedAt: new Date(now()).toISOString() });
      await repository.put(publisherId, revoked);
      return revoked;
    },

    async getTrust(publisherId) {
      return (await repository.get(publisherId)) ?? null;
    },

    // Optional: only usable when the injected repository itself supports enumeration (real stores
    // do; the minimal {put,get}-only fakes used by earlier tests do not). Never throws for those —
    // returns an empty list instead, so this stays backward compatible with every existing caller.
    async list() {
      if (!repository.list) return [];
      return Object.freeze(await repository.list());
    },

    // Pure cryptographic check against the public key embedded in the package itself: proves the
    // package genuinely came from whoever holds the matching private key. Independent of trust —
    // isApproved() is the separate, local decision of whether Nasro trusts that key's fingerprint.
    async verifySignature({ publicKey, digest, signature }) {
      try {
        return cryptoVerify('sha256', Buffer.from(digest, 'utf8'), publicKey, Buffer.from(signature, 'base64'));
      } catch {
        return false;
      }
    },
  });
}
