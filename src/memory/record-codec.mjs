import { createHmac } from 'node:crypto';
import { createAad, decryptAead, encryptAead } from '../crypto/aead.mjs';

function normalize(value) {
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, normalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function sealRecord({ key, type, id, value }) {
  const plaintext = Buffer.from(canonicalJson(value));
  const envelope = encryptAead({
    key,
    plaintext,
    aad: createAad({ version: 1, type, id }),
  });
  return Buffer.from(canonicalJson(envelope));
}

export function openRecord({ key, type, id, ciphertext }) {
  const envelope = JSON.parse(Buffer.from(ciphertext).toString('utf8'));
  const plaintext = decryptAead({
    key,
    envelope,
    aad: createAad({ version: 1, type, id }),
  });
  return JSON.parse(plaintext.toString('utf8'));
}

export function blindHash(key, domain, value) {
  if (value === undefined || value === null) return null;
  return createHmac('sha256', key)
    .update(domain)
    .update('\0')
    .update(String(value).normalize('NFKC'))
    .digest();
}
