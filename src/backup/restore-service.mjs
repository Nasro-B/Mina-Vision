import { createHash, timingSafeEqual } from 'node:crypto';
import { createAad, decryptAead } from '../crypto/aead.mjs';
import { canonicalJson } from '../memory/record-codec.mjs';
import { deriveBackupKeys, signManifest } from './backup-service.mjs';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function verifyManifest(manifest, key) {
  const { signature, ...core } = manifest;
  const expected = Buffer.from(signManifest(core, key));
  const received = Buffer.from(String(signature ?? ''));
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error('backup_manifest_signature_invalid');
  }
}

function open(bytes, { type, id, key }) {
  const envelope = JSON.parse(Buffer.from(bytes).toString('utf8'));
  const plaintext = decryptAead({
    key,
    envelope,
    aad: createAad({ version: 1, type, id }),
  });
  return JSON.parse(plaintext.toString('utf8'));
}

export function createRestoreService({ remote, backupKey } = {}) {
  if (!remote?.getObject || !remote?.listObjects) throw new TypeError('restore_remote_required');
  const keys = deriveBackupKeys(backupKey);

  async function restore({ snapshotId, target } = {}) {
    if (!target?.beginTemporary) throw new TypeError('restore_target_required');
    const manifestBytes = await remote.getObject(`manifests/${snapshotId}.json`);
    if (!manifestBytes) throw new Error('backup_manifest_not_found');
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    verifyManifest(manifest, keys.manifestKey);
    const records = [];
    const tombstones = [];
    for (const entry of manifest.entries) {
      const bytes = await remote.getObject(entry.objectKey);
      if (!bytes || digest(bytes) !== entry.digest) throw new Error('backup_blob_digest_mismatch');
      const value = open(bytes, {
        type: entry.kind === 'record' ? 'backup_record' : 'backup_tombstone',
        id: entry.id,
        key: keys.blobKey,
      });
      (entry.kind === 'record' ? records : tombstones).push(value);
    }
    for (const objectKey of await remote.listObjects('tombstones')) {
      const bytes = await remote.getObject(objectKey);
      if (!bytes) continue;
      const wrapper = JSON.parse(bytes.toString('utf8'));
      if (wrapper.version !== 1 || !wrapper.id || !wrapper.envelope) throw new Error('invalid_backup_tombstone');
      tombstones.push(open(Buffer.from(canonicalJson(wrapper.envelope)), {
        type: 'backup_tombstone', id: wrapper.id, key: keys.blobKey,
      }));
    }
    const forgotten = new Set(tombstones.map(({ target: value }) => value));
    const restorable = records.filter((record) => !forgotten.has(`event:${record.id}`));
    const temporary = await target.beginTemporary();
    try {
      for (const record of restorable) await temporary.write(record);
      await temporary.commit();
      return Object.freeze({ restored: restorable.length, forgotten: records.length - restorable.length });
    } catch (error) {
      await temporary.rollback();
      throw error;
    }
  }

  return Object.freeze({ restore });
}
