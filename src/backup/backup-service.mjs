import { createHash, createHmac, hkdfSync } from 'node:crypto';
import { createAad, encryptAead } from '../crypto/aead.mjs';
import { canonicalJson } from '../memory/record-codec.mjs';

const SALT = Buffer.from('mina-vision-backup-v1');

export function deriveBackupKeys(backupKey) {
  const source = Buffer.from(backupKey ?? []);
  if (source.length !== 32) throw new TypeError('backup_key_required');
  const derive = (info) => Buffer.from(hkdfSync('sha256', source, SALT, Buffer.from(info), 32));
  return Object.freeze({
    blobKey: derive('blob-aead'),
    nonceKey: derive('blob-nonce'),
    manifestKey: derive('manifest-hmac'),
  });
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateId(id, kind) {
  if (!id || !/^[A-Za-z0-9._:-]{1,160}$/u.test(id)) throw new TypeError(`invalid_${kind}_id`);
  return id;
}

function signManifest(core, manifestKey) {
  return createHmac('sha256', manifestKey).update(canonicalJson(core)).digest('base64url');
}

function seal(value, { type, id, keys }) {
  const plaintext = Buffer.from(canonicalJson(value));
  const contentDigest = digest(plaintext);
  const nonce = createHmac('sha256', keys.nonceKey)
    .update(type).update('\0').update(id).update('\0').update(contentDigest)
    .digest().subarray(0, 12);
  const envelope = encryptAead({
    key: keys.blobKey,
    plaintext,
    aad: createAad({ version: 1, type, id }),
    nonce,
  });
  return Buffer.from(canonicalJson(envelope));
}

export function createBackupService({ remote, backupKey, now = Date.now } = {}) {
  if (!remote?.putObject || !remote?.getObject || !remote?.hasObject || !remote?.listObjects) {
    throw new TypeError('backup_remote_required');
  }
  const keys = deriveBackupKeys(backupKey);

  async function backup({ snapshotId, records = [], tombstones = [] } = {}) {
    validateId(snapshotId, 'snapshot');
    const values = [
      ...records.map((record) => ({ kind: 'record', value: record })),
      ...tombstones.map((tombstone) => ({ kind: 'tombstone', value: tombstone })),
    ].sort((left, right) => String(left.value.id).localeCompare(String(right.value.id)));
    const entries = [];
    let uploaded = 0;
    let deduplicated = 0;
    for (const { kind, value } of values) {
      validateId(value?.id, kind);
      const type = kind === 'record' ? 'backup_record' : 'backup_tombstone';
      const bytes = seal(value, { type, id: value.id, keys });
      const ciphertextDigest = digest(bytes);
      const objectKey = `blobs/${ciphertextDigest}.json`;
      if (await remote.hasObject(objectKey)) deduplicated += 1;
      else {
        await remote.putObject(objectKey, bytes);
        uploaded += 1;
      }
      entries.push({ id: value.id, kind, digest: ciphertextDigest, objectKey });
    }
    const comparable = { version: 1, snapshotId, entries };
    const manifestKey = `manifests/${snapshotId}.json`;
    const existingBytes = await remote.getObject(manifestKey);
    if (existingBytes) {
      const existing = JSON.parse(existingBytes.toString('utf8'));
      if (canonicalJson({ version: existing.version, snapshotId: existing.snapshotId, entries: existing.entries })
        !== canonicalJson(comparable)) {
        throw new Error('backup_manifest_conflict');
      }
      return Object.freeze({ snapshotId, uploaded, deduplicated, manifest: manifestKey });
    }
    const core = { ...comparable, createdAt: now() };
    const manifest = { ...core, signature: signManifest(core, keys.manifestKey) };
    await remote.putObject(manifestKey, Buffer.from(canonicalJson(manifest)));
    return Object.freeze({ snapshotId, uploaded, deduplicated, manifest: manifestKey });
  }

  async function publishTombstone(tombstone) {
    validateId(tombstone?.id, 'tombstone');
    if (!tombstone.target || !Number.isFinite(tombstone.createdAt)) throw new TypeError('invalid_backup_tombstone');
    const envelope = seal(tombstone, { type: 'backup_tombstone', id: tombstone.id, keys });
    const bytes = Buffer.from(canonicalJson({
      version: 1,
      id: tombstone.id,
      envelope: JSON.parse(envelope.toString('utf8')),
    }));
    const targetDigest = createHmac('sha256', keys.manifestKey).update(tombstone.target).digest('hex');
    const objectKey = `tombstones/${targetDigest}.json`;
    await remote.putObject(objectKey, bytes);
    return Object.freeze({ objectKey, digest: digest(bytes) });
  }

  return Object.freeze({ backup, publishTombstone });
}

export { signManifest };
