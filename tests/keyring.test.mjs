import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createKeyring } from '../src/crypto/keyring.mjs';
import { generateRecoveryPhrase } from '../src/crypto/recovery-phrase.mjs';

function createStorage() {
  let value = null;
  let rotation = null;
  return {
    read: async () => structuredClone(value),
    writeAtomic: async (next) => { value = structuredClone(next); },
    readRotation: async () => structuredClone(rotation),
    writeRotationAtomic: async (next) => { rotation = structuredClone(next); },
    clearRotation: async () => { rotation = null; },
    inspect: () => structuredClone(value),
    inspectRotation: () => structuredClone(rotation),
  };
}

function createSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`dpapi:${value}`),
    decryptString: (value) => value.toString().slice('dpapi:'.length),
  };
}

function createArgon2() {
  return {
    argon2id: 2,
    hash: vi.fn(async (phrase, options) => createHash('sha256')
      .update(phrase)
      .update(options.salt)
      .digest()
      .subarray(0, options.hashLength)),
  };
}

describe('keyring', () => {
  it('stores only wrapped key material and opens through DPAPI', async () => {
    const storage = createStorage();
    const argon2Impl = createArgon2();
    const first = createKeyring({ storage, safeStorage: createSafeStorage(), argon2Impl });

    const { recoveryPhrase, masterKey } = await first.initialize();
    const record = storage.inspect();
    const reopened = createKeyring({ storage, safeStorage: createSafeStorage(), argon2Impl });

    expect(recoveryPhrase.split(' ')).toHaveLength(12);
    expect(await reopened.open()).toEqual(masterKey);
    expect(Object.keys(record).sort()).toEqual([
      'argon2',
      'checksum',
      'recoveryEnvelope',
      'recoverySalt',
      'version',
      'wrappedMasterKey',
    ]);
    expect(JSON.stringify(record)).not.toContain(recoveryPhrase);
    expect(JSON.stringify(record)).not.toContain(masterKey.toString('hex'));
    expect(JSON.stringify(record)).not.toContain(masterKey.toString('base64'));
  });

  it('opens with the correct recovery phrase and rejects another valid phrase', async () => {
    const storage = createStorage();
    const argon2Impl = createArgon2();
    const keyring = createKeyring({ storage, safeStorage: createSafeStorage(), argon2Impl });
    const { recoveryPhrase, masterKey } = await keyring.initialize();
    const recoveryOnly = createKeyring({ storage, safeStorage: createSafeStorage(false), argon2Impl });

    expect(await recoveryOnly.openWithRecovery(recoveryPhrase)).toEqual(masterKey);
    await expect(recoveryOnly.openWithRecovery(generateRecoveryPhrase())).rejects.toThrow();
  });

  it('stores domain secrets encrypted and reopens them without plaintext persistence', async () => {
    const storage = createStorage();
    const options = { storage, safeStorage: createSafeStorage(), argon2Impl: createArgon2() };
    const keyring = createKeyring(options);
    await keyring.initialize();

    await keyring.setSecret('provider/deepseek/api-key', 'DEEPSEEK_PLAINTEXT_MARKER');
    expect(await keyring.hasSecret('provider/deepseek/api-key')).toBe(true);
    expect(await createKeyring(options).getSecret('provider/deepseek/api-key')).toBe('DEEPSEEK_PLAINTEXT_MARKER');
    expect(JSON.stringify(storage.inspect())).not.toContain('DEEPSEEK_PLAINTEXT_MARKER');
    await keyring.deleteSecret('provider/deepseek/api-key');
    expect(await keyring.hasSecret('provider/deepseek/api-key')).toBe(false);
  });

  it('uses the required Argon2id parameters', async () => {
    const storage = createStorage();
    const argon2Impl = createArgon2();
    const keyring = createKeyring({ storage, safeStorage: createSafeStorage(), argon2Impl });

    await keyring.initialize();

    expect(argon2Impl.hash).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      type: 2,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32,
      raw: true,
      salt: expect.any(Buffer),
    }));
    expect(argon2Impl.hash.mock.calls[0][1].salt).toHaveLength(16);
  });

  it('refuses normal initialization and opening when safeStorage is unavailable', async () => {
    const storage = createStorage();
    const keyring = createKeyring({ storage, safeStorage: createSafeStorage(false), argon2Impl: createArgon2() });

    await expect(keyring.initialize()).rejects.toThrow('safe_storage_unavailable');
    await expect(keyring.open()).rejects.toThrow('safe_storage_unavailable');
  });

  it('rotates by batches, journals progress and removes the old key only after verification', async () => {
    const storage = createStorage();
    const argon2Impl = createArgon2();
    const safeStorage = createSafeStorage();
    const keyring = createKeyring({ storage, safeStorage, argon2Impl });
    const { recoveryPhrase, masterKey: oldKey } = await keyring.initialize();
    const cursors = [];

    const result = await keyring.rotate({
      recoveryPhrase,
      batchSize: 2,
      reencryptBatch: async ({ oldKey: suppliedOldKey, newKey, cursor, batchSize }) => {
        expect(suppliedOldKey).toEqual(oldKey);
        expect(newKey).not.toEqual(oldKey);
        expect(batchSize).toBe(2);
        cursors.push(cursor);
        if (cursor === null) return { cursor: 'batch-1', processed: 2, done: false };
        return { cursor: 'batch-2', processed: 1, done: true };
      },
      verify: async ({ oldKey: suppliedOldKey, newKey, processed }) => {
        expect(suppliedOldKey).toEqual(oldKey);
        expect(newKey).not.toEqual(oldKey);
        expect(processed).toBe(3);
        return true;
      },
    });

    expect(cursors).toEqual([null, 'batch-1']);
    expect(result.processed).toBe(3);
    expect(result.masterKey).not.toEqual(oldKey);
    expect(await keyring.open()).toEqual(result.masterKey);
    expect(await keyring.openWithRecovery(recoveryPhrase)).toEqual(result.masterKey);
    expect(storage.inspectRotation()).toBeNull();
    expect(JSON.stringify(storage.inspect())).not.toContain(oldKey.toString('hex'));
  });

  it('re-encrypts domain secrets during master-key rotation', async () => {
    const storage = createStorage();
    const keyring = createKeyring({ storage, safeStorage: createSafeStorage(), argon2Impl: createArgon2() });
    const { recoveryPhrase } = await keyring.initialize();
    await keyring.setSecret('provider/gemini/api-key', 'GEMINI_ROTATION_MARKER');
    const before = JSON.stringify(storage.inspect().secrets);

    await keyring.rotate({
      recoveryPhrase,
      reencryptBatch: async () => ({ processed: 0, done: true }),
      verify: async () => true,
    });

    expect(await keyring.getSecret('provider/gemini/api-key')).toBe('GEMINI_ROTATION_MARKER');
    expect(JSON.stringify(storage.inspect().secrets)).not.toBe(before);
    expect(JSON.stringify(storage.inspect())).not.toContain('GEMINI_ROTATION_MARKER');
  });

  it('resumes an interrupted rotation from its durable cursor', async () => {
    const storage = createStorage();
    const argon2Impl = createArgon2();
    const safeStorage = createSafeStorage();
    const keyring = createKeyring({ storage, safeStorage, argon2Impl });
    const { recoveryPhrase } = await keyring.initialize();

    await expect(keyring.rotate({
      recoveryPhrase,
      reencryptBatch: async () => ({ cursor: 'saved-cursor', processed: 4, done: false }),
      verify: async () => true,
      maxBatches: 1,
    })).rejects.toThrow('key_rotation_interrupted');

    expect(storage.inspectRotation()).toEqual(expect.objectContaining({
      cursor: 'saved-cursor',
      processed: 4,
      status: 'reencrypting',
    }));

    const resumedCursors = [];
    const result = await keyring.rotate({
      recoveryPhrase,
      reencryptBatch: async ({ cursor }) => {
        resumedCursors.push(cursor);
        return { cursor: 'finished', processed: 2, done: true };
      },
      verify: async ({ processed }) => processed === 6,
    });

    expect(resumedCursors).toEqual(['saved-cursor']);
    expect(result.processed).toBe(6);
    expect(storage.inspectRotation()).toBeNull();
  });

  it('keeps the current key and rotation journal when verification fails', async () => {
    const storage = createStorage();
    const keyring = createKeyring({
      storage,
      safeStorage: createSafeStorage(),
      argon2Impl: createArgon2(),
    });
    const { recoveryPhrase, masterKey } = await keyring.initialize();

    await expect(keyring.rotate({
      recoveryPhrase,
      reencryptBatch: async () => ({ cursor: 'finished', processed: 1, done: true }),
      verify: async () => false,
    })).rejects.toThrow('key_rotation_verification_failed');

    expect(await keyring.open()).toEqual(masterKey);
    expect(storage.inspectRotation()).toEqual(expect.objectContaining({ status: 'verifying' }));
  });
});
