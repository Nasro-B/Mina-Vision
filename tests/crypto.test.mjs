import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAad, decryptAead, encryptAead } from '../src/crypto/aead.mjs';
import {
  ENGLISH_WORDLIST,
  generateRecoveryPhrase,
  normalizeRecoveryPhrase,
  validateRecoveryPhrase,
} from '../src/crypto/recovery-phrase.mjs';
import { createSafeStorageAdapter } from '../src/crypto/safe-storage-adapter.mjs';

describe('AES-256-GCM', () => {
  it('round-trips bytes with versioned AAD and unique 96-bit nonces', () => {
    const key = randomBytes(32);
    const aad = createAad({ version: 1, type: 'memory_event', id: 'event-1' });
    const first = encryptAead({ key, plaintext: Buffer.from('secret'), aad });
    const second = encryptAead({ key, plaintext: Buffer.from('secret'), aad });

    expect(decryptAead({ key, envelope: first, aad })).toEqual(Buffer.from('secret'));
    expect(Buffer.from(first.nonce, 'base64')).toHaveLength(12);
    expect(first.nonce).not.toBe(second.nonce);
  });

  it.each(['aad', 'tag', 'key', 'ciphertext'])('rejects a wrong or altered %s', (part) => {
    const key = randomBytes(32);
    const aad = createAad({ version: 1, type: 'memory_event', id: 'event-1' });
    const envelope = encryptAead({ key, plaintext: Buffer.from('secret'), aad });
    const changed = { ...envelope };
    let decryptKey = key;
    let decryptAad = aad;
    if (part === 'aad') decryptAad = createAad({ version: 1, type: 'memory_event', id: 'event-2' });
    if (part === 'key') decryptKey = randomBytes(32);
    if (part === 'tag') changed.authTag = Buffer.alloc(16, 7).toString('base64');
    if (part === 'ciphertext') changed.ciphertext = Buffer.from('altered').toString('base64');

    expect(() => decryptAead({ key: decryptKey, envelope: changed, aad: decryptAad })).toThrow();
  });
});

describe('recovery phrase', () => {
  it('generates a valid 12-word BIP-39 phrase from the official English list', () => {
    const phrase = generateRecoveryPhrase();

    expect(ENGLISH_WORDLIST).toHaveLength(2_048);
    expect(phrase.split(' ')).toHaveLength(12);
    expect(validateRecoveryPhrase(phrase)).toBe(true);
  });

  it('normalizes whitespace and Unicode with NFKD', () => {
    expect(normalizeRecoveryPhrase('  abandon   ability\n able  ')).toBe('abandon ability able');
    expect(normalizeRecoveryPhrase('é')).toBe('é');
  });
});

describe('safeStorage adapter', () => {
  it('round-trips a key without a plaintext fallback', () => {
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`wrapped:${value}`),
      decryptString: (value) => value.toString().slice('wrapped:'.length),
    };
    const adapter = createSafeStorageAdapter(safeStorage);
    const key = randomBytes(32);

    expect(adapter.unwrap(adapter.wrap(key))).toEqual(key);
  });

  it('fails closed when OS encryption is unavailable', () => {
    expect(() => createSafeStorageAdapter({ isEncryptionAvailable: () => false }))
      .toThrow('safe_storage_unavailable');
  });
});
