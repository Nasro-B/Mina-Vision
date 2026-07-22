import { blindHash, openRecord, sealRecord } from './record-codec.mjs';

export function createIdentityRepository({ db, encryptionKey, indexKey } = {}) {
  if (!db || Buffer.from(encryptionKey ?? []).length !== 32 || Buffer.from(indexKey ?? []).length !== 32) {
    throw new TypeError('identity_repository_configuration_required');
  }
  const insertIdentity = db.prepare(`
    INSERT INTO identities (identity_id, identity_hash, ciphertext, created_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertLink = db.prepare(`
    INSERT INTO identity_links (link_id, identity_id, link_hash, ciphertext, verified_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const findLink = db.prepare(`
    SELECT i.identity_id, i.ciphertext
    FROM identity_links l
    JOIN identities i ON i.identity_id = l.identity_id
    WHERE l.link_hash = ?
  `);
  const findIdentity = db.prepare('SELECT ciphertext FROM identities WHERE identity_id = ?');

  function writeIdentity(identity) {
    if (!identity?.id) throw new TypeError('invalid_identity');
    insertIdentity.run(
      identity.id,
      blindHash(indexKey, 'identity_id', identity.id),
      sealRecord({ key: encryptionKey, type: 'identity', id: identity.id, value: identity }),
      identity.createdAt ?? Date.now(),
    );
  }

  function link(value) {
    if (!value?.id || !value.identityId || !value.kind || !value.value || !Number.isFinite(value.verifiedAt)) {
      throw new TypeError('invalid_identity_link');
    }
    insertLink.run(
      value.id,
      value.identityId,
      blindHash(indexKey, `identity_link:${value.kind}`, value.value),
      sealRecord({ key: encryptionKey, type: 'identity_link', id: value.id, value }),
      value.verifiedAt,
    );
  }

  function findByLink({ kind, value }) {
    const row = findLink.get(blindHash(indexKey, `identity_link:${kind}`, value));
    if (!row) return null;
    return openRecord({ key: encryptionKey, type: 'identity', id: row.identity_id, ciphertext: row.ciphertext });
  }

  function readIdentity(identityId) {
    const row = findIdentity.get(identityId);
    if (!row) return null;
    return openRecord({ key: encryptionKey, type: 'identity', id: identityId, ciphertext: row.ciphertext });
  }

  return Object.freeze({ writeIdentity, link, findByLink, readIdentity });
}
