// Récupération du coffre quand le chiffrement Windows (DPAPI/os_crypt) ne peut plus déchiffrer
// le wrappedMasterKey — cas réel du 2026-07-22 (clé os_crypt écrasée lors de la migration de
// userData du 20/07) :
//   1. open() doit lever une erreur NOMINÉE et actionnable (→ phrase de récupération), pas le
//      charabia brut de safeStorage.
//   2. openWithRecovery(phrase) doit SE RÉPARER : re-wrapper la master key avec le safeStorage
//      ACTUEL et persister — le déverrouillage sans phrase remarche ensuite.
//   3. Si la persistance du re-wrap échoue, le déverrouillage par phrase réussit quand même.

import { describe, expect, it, vi } from 'vitest';
import { createKeyring } from '../src/crypto/keyring.mjs';

function createStorage() {
  let value = null;
  return {
    read: async () => structuredClone(value),
    writeAtomic: async (next) => { value = structuredClone(next); },
    inspect: () => structuredClone(value),
  };
}

// safeStorage à générations : chaque génération chiffre avec un « secret » différent ; une
// génération ne déchiffre pas les blobs d'une autre — modèle exact du bug os_crypt réel.
function createGenerationalSafeStorage(generation = 1) {
  let current = generation;
  return {
    setGeneration: (next) => { current = next; },
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`gen${current}:${value}`),
    decryptString: (buffer) => {
      const text = buffer.toString();
      const match = text.match(/^gen(\d+):(.*)$/u);
      if (!match || Number(match[1]) !== current) {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      }
      return match[2];
    },
  };
}

const argon2Fake = {
  argon2id: 2,
  hash: async (phrase, { salt, hashLength }) => {
    const { createHash } = await import('node:crypto');
    return createHash('sha512').update(phrase).update(salt).digest().subarray(0, hashLength);
  },
};

async function buildBrokenKeyring() {
  const storage = createStorage();
  const safeStorage = createGenerationalSafeStorage(1);
  const keyring = createKeyring({ storage, safeStorage, argon2Impl: argon2Fake });
  const { recoveryPhrase } = await keyring.initialize();
  // La clé de chiffrement change (migration userData / os_crypt écrasée) :
  safeStorage.setGeneration(2);
  return { keyring, storage, safeStorage, recoveryPhrase };
}

describe('keyring — chiffrement Windows cassé', () => {
  it('open() lève une erreur nominée orientant vers la phrase de récupération', async () => {
    const { keyring } = await buildBrokenKeyring();
    await expect(keyring.open()).rejects.toThrow(/keyring_wrapped_key_undecryptable/u);
    await expect(keyring.open()).rejects.toThrow(/phrase de récupération/u);
  });

  it('openWithRecovery répare : re-wrap persisté, open() sans phrase remarche ensuite', async () => {
    const { keyring, storage, recoveryPhrase } = await buildBrokenKeyring();
    const before = storage.inspect().wrappedMasterKey;

    const masterKey = await keyring.openWithRecovery(recoveryPhrase);
    expect(masterKey.length).toBe(32);

    // Le wrappedMasterKey a été réécrit avec la clé ACTUELLE…
    expect(storage.inspect().wrappedMasterKey).not.toBe(before);
    // …et le déverrouillage automatique refonctionne.
    const reopened = await keyring.open();
    expect(reopened.length).toBe(32);
  });

  it('le re-wrap ne touche à rien d\'autre (recoveryEnvelope, checksum, secrets intacts)', async () => {
    const { keyring, storage, recoveryPhrase } = await buildBrokenKeyring();
    const before = storage.inspect();
    await keyring.openWithRecovery(recoveryPhrase);
    const after = storage.inspect();
    expect(after.recoveryEnvelope).toEqual(before.recoveryEnvelope);
    expect(after.checksum).toBe(before.checksum);
    expect(after.recoverySalt).toBe(before.recoverySalt);
  });

  it('si la persistance du re-wrap échoue, le déverrouillage par phrase réussit quand même', async () => {
    const { keyring, storage, recoveryPhrase } = await buildBrokenKeyring();
    storage.writeAtomic = vi.fn(async () => { throw new Error('disque plein'); });
    const masterKey = await keyring.openWithRecovery(recoveryPhrase);
    expect(masterKey.length).toBe(32);
  });

  it('quand le wrap est SAIN, openWithRecovery ne réécrit rien (pas d\'écriture parasite)', async () => {
    const storage = createStorage();
    const safeStorage = createGenerationalSafeStorage(1);
    const keyring = createKeyring({ storage, safeStorage, argon2Impl: argon2Fake });
    const { recoveryPhrase } = await keyring.initialize();
    const writes = vi.spyOn(storage, 'writeAtomic');
    await keyring.openWithRecovery(recoveryPhrase);
    expect(writes).not.toHaveBeenCalled();
  });

  it('une mauvaise phrase reste refusée, wrap cassé ou pas', async () => {
    const { keyring } = await buildBrokenKeyring();
    await expect(keyring.openWithRecovery('mauvaise phrase totalement inventée ici oui'))
      .rejects.toThrow();
  });
});
