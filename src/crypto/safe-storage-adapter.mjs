export function createSafeStorageAdapter(safeStorage) {
  if (!safeStorage?.isEncryptionAvailable?.()) throw new Error('safe_storage_unavailable');
  if (!safeStorage.encryptString || !safeStorage.decryptString) throw new Error('safe_storage_unavailable');

  return Object.freeze({
    wrap(key) {
      const encodedKey = Buffer.from(key).toString('base64');
      return Buffer.from(safeStorage.encryptString(encodedKey)).toString('base64');
    },
    unwrap(wrapped) {
      const encodedKey = safeStorage.decryptString(Buffer.from(wrapped, 'base64'));
      const key = Buffer.from(encodedKey, 'base64');
      if (key.length !== 32) throw new Error('invalid_wrapped_master_key');
      return key;
    },
  });
}
