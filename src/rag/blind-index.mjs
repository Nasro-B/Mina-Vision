import { createHmac, hkdfSync } from 'node:crypto';
import { tokenizeFrench, TOKENIZER_VERSION } from './tokenizer.mjs';

const HKDF_SALT = Buffer.from('mina-blind-index-v1', 'utf8');
const HKDF_INFO = Buffer.from(`lexical-token-hmac:tokenizer-${TOKENIZER_VERSION}`, 'utf8');

export function createBlindIndex({ masterKey } = {}) {
  const sourceKey = Buffer.from(masterKey ?? []);
  if (sourceKey.length !== 32) throw new TypeError('blind_index_master_key_required');
  const hmacKey = Buffer.from(hkdfSync('sha256', sourceKey, HKDF_SALT, HKDF_INFO, 32));

  function hashToken(token) {
    return createHmac('sha256', hmacKey)
      .update(String(token).normalize('NFKC'))
      .digest()
      .subarray(0, 16);
  }

  function indexText(text) {
    const frequencies = new Map();
    for (const token of tokenizeFrench(text)) {
      const hash = hashToken(token);
      const key = hash.toString('hex');
      const current = frequencies.get(key);
      frequencies.set(key, { hash, frequency: (current?.frequency ?? 0) + 1 });
    }
    return [...frequencies.values()].sort((a, b) => Buffer.compare(a.hash, b.hash));
  }

  function query(text) {
    return indexText(text).map(({ hash }) => hash);
  }

  return Object.freeze({ hashToken, indexText, query, tokenizerVersion: TOKENIZER_VERSION });
}
