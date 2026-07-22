import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function requireKey(key) {
  const value = Buffer.from(key ?? []);
  if (value.length !== 32) throw new TypeError('aead_key_must_be_32_bytes');
  return value;
}

export function createAad({ version, type, id }) {
  if (version !== 1 || !type || !id) throw new TypeError('invalid_aad');
  return Buffer.from(JSON.stringify({ version, type, id }), 'utf8');
}

export function encryptAead({ key, plaintext, aad, nonce = randomBytes(12) }) {
  const encryptionKey = requireKey(key);
  const nonceBytes = Buffer.from(nonce);
  if (nonceBytes.length !== 12) throw new TypeError('aead_nonce_must_be_12_bytes');
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonceBytes);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return Object.freeze({
    version: 1,
    nonce: nonceBytes.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  });
}

export function decryptAead({ key, envelope, aad }) {
  if (envelope?.version !== 1) throw new TypeError('unsupported_aead_version');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    requireKey(key),
    Buffer.from(envelope.nonce, 'base64'),
  );
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
}
