import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

export const ENGLISH_WORDLIST = Object.freeze([...wordlist]);

export function normalizeRecoveryPhrase(phrase) {
  return String(phrase ?? '').normalize('NFKD').trim().split(/\s+/u).filter(Boolean).join(' ');
}

export function generateRecoveryPhrase() {
  return generateMnemonic(ENGLISH_WORDLIST, 128).normalize('NFKD');
}

export function validateRecoveryPhrase(phrase) {
  const normalized = normalizeRecoveryPhrase(phrase);
  return normalized.split(' ').length === 12 && validateMnemonic(normalized, ENGLISH_WORDLIST);
}
