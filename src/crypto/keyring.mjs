import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { createAad, decryptAead, encryptAead } from './aead.mjs';
import { generateRecoveryPhrase, normalizeRecoveryPhrase, validateRecoveryPhrase } from './recovery-phrase.mjs';
import { createSafeStorageAdapter } from './safe-storage-adapter.mjs';

const ARGON2_PARAMETERS = Object.freeze({
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});
const RECOVERY_AAD = createAad({ version: 1, type: 'keyring_recovery', id: 'master' });
const SECRET_NAME = /^[a-z0-9][a-z0-9/_-]{0,199}$/u;

function checksum(key) {
  return createHash('sha256').update(key).digest('base64url');
}

function verifyChecksum(key, expected) {
  if (checksum(key) !== expected) throw new Error('keyring_checksum_mismatch');
  return key;
}

function validateSecret(name, value) {
  if (!SECRET_NAME.test(name)) throw new TypeError('invalid_keyring_secret_name');
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > 64 * 1024) {
    throw new TypeError('invalid_keyring_secret_value');
  }
}

function secretAad(name) {
  return createAad({ version: 1, type: 'keyring_secret', id: name });
}

export function createKeyring({ storage, safeStorage, argon2Impl = argon2 } = {}) {
  if (!storage?.read || !storage?.writeAtomic) throw new TypeError('keyring_storage_required');

  async function deriveRecoveryKey(phrase, salt, parameters = ARGON2_PARAMETERS) {
    const normalized = normalizeRecoveryPhrase(phrase);
    if (!validateRecoveryPhrase(normalized)) throw new Error('invalid_recovery_phrase');
    return Buffer.from(await argon2Impl.hash(normalized, {
      type: argon2Impl.argon2id,
      memoryCost: parameters.memoryCost,
      timeCost: parameters.timeCost,
      parallelism: parameters.parallelism,
      hashLength: parameters.hashLength,
      raw: true,
      salt,
    }));
  }

  async function initialize() {
    if (await storage.read()) throw new Error('keyring_already_initialized');
    const adapter = createSafeStorageAdapter(safeStorage);
    const recoveryPhrase = generateRecoveryPhrase();
    const masterKey = randomBytes(32);
    const recoverySalt = randomBytes(16);
    const recoveryKey = await deriveRecoveryKey(recoveryPhrase, recoverySalt);
    const record = {
      version: 1,
      wrappedMasterKey: adapter.wrap(masterKey),
      recoveryEnvelope: encryptAead({
        key: recoveryKey,
        plaintext: masterKey,
        aad: RECOVERY_AAD,
      }),
      recoverySalt: recoverySalt.toString('base64'),
      argon2: { ...ARGON2_PARAMETERS },
      checksum: checksum(masterKey),
    };
    await storage.writeAtomic(record);
    return Object.freeze({ recoveryPhrase, masterKey: Buffer.from(masterKey) });
  }

  async function open() {
    const adapter = createSafeStorageAdapter(safeStorage);
    const record = await storage.read();
    if (!record) throw new Error('keyring_not_initialized');
    let unwrapped;
    try {
      unwrapped = adapter.unwrap(record.wrappedMasterKey);
    } catch {
      // Cas réel (2026-07-22) : la clé os_crypt/DPAPI qui protégeait le wrap n'existe plus
      // (migration de userData, réinstallation, changement de profil Windows). Le coffre n'est
      // PAS perdu : la phrase de récupération le rouvre et openWithRecovery re-wrappe alors
      // automatiquement avec la clé actuelle.
      throw new Error(
        'keyring_wrapped_key_undecryptable: le chiffrement Windows a changé — '
        + 'déverrouillez avec la phrase de récupération pour réparer automatiquement.',
      );
    }
    return verifyChecksum(unwrapped, record.checksum);
  }

  async function openWithRecovery(phrase) {
    const record = await storage.read();
    if (!record) throw new Error('keyring_not_initialized');
    const recoveryKey = await deriveRecoveryKey(
      phrase,
      Buffer.from(record.recoverySalt, 'base64'),
      record.argon2,
    );
    const masterKey = decryptAead({
      key: recoveryKey,
      envelope: record.recoveryEnvelope,
      aad: RECOVERY_AAD,
    });
    const verified = verifyChecksum(masterKey, record.checksum);

    // AUTO-RÉPARATION : si le wrap DPAPI courant ne sait plus déchiffrer (clé Windows changée),
    // on re-wrappe la master key avec le chiffrement ACTUEL — le déverrouillage sans phrase
    // refonctionne dès la prochaine fois. Best-effort : un échec d'écriture ne bloque jamais
    // le déverrouillage par phrase (le coffre reste ouvrable, la réparation se retentera).
    try {
      const adapter = createSafeStorageAdapter(safeStorage);
      let healthy = false;
      try {
        adapter.unwrap(record.wrappedMasterKey).fill(0);
        healthy = true;
      } catch {
        healthy = false;
      }
      if (!healthy) {
        await storage.writeAtomic({ ...record, wrappedMasterKey: adapter.wrap(verified) });
      }
    } catch {
      // safeStorage indisponible ou écriture impossible : déverrouillage par phrase inchangé.
    }
    return verified;
  }

  async function setSecret(name, value) {
    validateSecret(name, value);
    if (storage.readRotation && await storage.readRotation()) throw new Error('keyring_rotation_in_progress');
    const record = await storage.read();
    if (!record) throw new Error('keyring_not_initialized');
    const masterKey = await open();
    try {
      await storage.writeAtomic({
        ...record,
        secrets: {
          ...(record.secrets ?? {}),
          [name]: encryptAead({ key: masterKey, plaintext: Buffer.from(value, 'utf8'), aad: secretAad(name) }),
        },
      });
    } finally {
      masterKey.fill(0);
    }
  }

  async function hasSecret(name) {
    if (!SECRET_NAME.test(name)) throw new TypeError('invalid_keyring_secret_name');
    const record = await storage.read();
    return Boolean(record?.secrets && Object.hasOwn(record.secrets, name));
  }

  async function getSecret(name) {
    if (!SECRET_NAME.test(name)) throw new TypeError('invalid_keyring_secret_name');
    const record = await storage.read();
    const envelope = record?.secrets?.[name];
    if (!envelope) return null;
    const masterKey = await open();
    try {
      return decryptAead({ key: masterKey, envelope, aad: secretAad(name) }).toString('utf8');
    } finally {
      masterKey.fill(0);
    }
  }

  async function deleteSecret(name) {
    if (!SECRET_NAME.test(name)) throw new TypeError('invalid_keyring_secret_name');
    if (storage.readRotation && await storage.readRotation()) throw new Error('keyring_rotation_in_progress');
    const record = await storage.read();
    if (!record?.secrets || !Object.hasOwn(record.secrets, name)) return false;
    const secrets = { ...record.secrets };
    delete secrets[name];
    await storage.writeAtomic({ ...record, ...(Object.keys(secrets).length ? { secrets } : { secrets: undefined }) });
    return true;
  }

  async function rotate({
    recoveryPhrase,
    reencryptBatch,
    verify,
    batchSize = 100,
    maxBatches = Number.POSITIVE_INFINITY,
  } = {}) {
    if (!storage.readRotation || !storage.writeRotationAtomic || !storage.clearRotation) {
      throw new TypeError('keyring_rotation_storage_required');
    }
    if (typeof reencryptBatch !== 'function' || typeof verify !== 'function') {
      throw new TypeError('keyring_rotation_callbacks_required');
    }
    if (!Number.isInteger(batchSize) || batchSize < 1) throw new TypeError('invalid_rotation_batch_size');

    const adapter = createSafeStorageAdapter(safeStorage);
    const record = await storage.read();
    if (!record) throw new Error('keyring_not_initialized');
    let journal = await storage.readRotation();

    if (journal && record.checksum === journal.targetRecord?.checksum) {
      const completedKey = verifyChecksum(adapter.unwrap(record.wrappedMasterKey), record.checksum);
      await storage.clearRotation();
      return Object.freeze({ masterKey: completedKey, processed: journal.processed });
    }
    if (journal && journal.sourceChecksum !== record.checksum) {
      throw new Error('key_rotation_source_mismatch');
    }

    const oldKey = verifyChecksum(adapter.unwrap(record.wrappedMasterKey), record.checksum);
    const recoveryKey = await deriveRecoveryKey(
      recoveryPhrase,
      Buffer.from(record.recoverySalt, 'base64'),
      record.argon2,
    );
    const recoveredOldKey = decryptAead({
      key: recoveryKey,
      envelope: record.recoveryEnvelope,
      aad: RECOVERY_AAD,
    });
    verifyChecksum(recoveredOldKey, record.checksum);

    if (!journal) {
      const newKey = randomBytes(32);
      const targetRecord = {
        version: record.version,
        wrappedMasterKey: adapter.wrap(newKey),
        recoveryEnvelope: encryptAead({
          key: recoveryKey,
          plaintext: newKey,
          aad: RECOVERY_AAD,
        }),
        recoverySalt: record.recoverySalt,
        argon2: { ...record.argon2 },
        checksum: checksum(newKey),
      };
      if (record.secrets) {
        targetRecord.secrets = Object.fromEntries(Object.entries(record.secrets).map(([name, envelope]) => {
          const plaintext = decryptAead({ key: oldKey, envelope, aad: secretAad(name) });
          try {
            return [name, encryptAead({ key: newKey, plaintext, aad: secretAad(name) })];
          } finally {
            plaintext.fill(0);
          }
        }));
      }
      journal = {
        version: 1,
        sourceChecksum: record.checksum,
        targetRecord,
        cursor: null,
        processed: 0,
        status: 'reencrypting',
      };
      await storage.writeRotationAtomic(journal);
    }

    const newKey = verifyChecksum(
      adapter.unwrap(journal.targetRecord.wrappedMasterKey),
      journal.targetRecord.checksum,
    );
    let batches = 0;
    while (journal.status === 'reencrypting') {
      const batch = await reencryptBatch({
        oldKey: Buffer.from(oldKey),
        newKey: Buffer.from(newKey),
        cursor: journal.cursor,
        batchSize,
      });
      if (!batch || typeof batch.done !== 'boolean'
        || !Number.isInteger(batch.processed) || batch.processed < 0) {
        throw new Error('invalid_rotation_batch_result');
      }
      journal = {
        ...journal,
        cursor: batch.cursor ?? journal.cursor,
        processed: journal.processed + batch.processed,
        status: batch.done ? 'verifying' : 'reencrypting',
      };
      await storage.writeRotationAtomic(journal);
      batches += 1;
      if (!batch.done && batches >= maxBatches) throw new Error('key_rotation_interrupted');
    }

    const verified = await verify({
      oldKey: Buffer.from(oldKey),
      newKey: Buffer.from(newKey),
      processed: journal.processed,
    });
    if (verified !== true) throw new Error('key_rotation_verification_failed');

    await storage.writeAtomic(journal.targetRecord);
    await storage.clearRotation();
    return Object.freeze({ masterKey: Buffer.from(newKey), processed: journal.processed });
  }

  return Object.freeze({
    initialize, open, openWithRecovery, setSecret, hasSecret, getSecret, deleteSecret, rotate,
  });
}
