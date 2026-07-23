// Générateur d'identifiants ULID MONOTONES, sans dépendance externe.
// 48 bits de temps + 80 bits d'aléa, encodés en Crockford Base32 (26 caractères).
//
// Deux garanties indispensables au ledger et à la déduplication :
//   1. l'ordre lexical suit l'ordre de création, même pour des milliers d'événements dans la
//      MÊME milliseconde (les 80 bits sont incrémentés au lieu d'être retirés au hasard) ;
//   2. si l'horloge système RECULE (NTP, changement d'heure), l'identifiant ne recule jamais —
//      on conserve le dernier timestamp connu. Un identifiant qui reculerait casserait l'ordre
//      du journal et pourrait faire réapparaître un événement déjà traité.

import { randomBytes as nodeRandomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const RANDOM_BYTES = 10; // 80 bits

function encodeTime(ms) {
  let value = ms;
  let out = '';
  for (let index = TIME_LENGTH - 1; index >= 0; index -= 1) {
    out = CROCKFORD[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeRandom(bytes) {
  // 80 bits → 16 caractères de 5 bits. On lit le tampon comme un grand entier big-endian.
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let out = '';
  for (let index = 0; index < RANDOM_LENGTH; index += 1) {
    out = CROCKFORD[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return out;
}

function incrementBigEndian(bytes) {
  // Retourne false si les 80 bits sont saturés : l'appelant retentera à la milliseconde
  // suivante plutôt que de boucler activement (aucun blocage du thread Node/UI).
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    if (bytes[index] < 0xff) {
      bytes[index] += 1;
      return true;
    }
    bytes[index] = 0;
  }
  return false;
}

export function createMonotonicUlid({ now = Date.now, randomBytes = nodeRandomBytes } = {}) {
  let lastTime = -1;
  let lastRandom = null;

  // Node est mono-thread pour ce chemin : la fonction ne contient AUCUN await, donc elle
  // s'exécute déjà de façon atomique vis-à-vis des autres appels.
  return function next() {
    const currentTime = Number(now());
    if (!Number.isInteger(currentTime) || currentTime < 0) throw new Error('ulid_horloge_invalide');

    if (currentTime > lastTime) {
      lastTime = currentTime;
      lastRandom = Buffer.from(randomBytes(RANDOM_BYTES));
    } else {
      // Même milliseconde OU horloge qui recule : on garde lastTime et on incrémente l'aléa.
      if (!incrementBigEndian(lastRandom)) throw new Error('ulid_entropy_exhausted');
    }
    return encodeTime(lastTime) + encodeRandom(lastRandom);
  };
}

export const decodeUlidTime = (ulid) => {
  let value = 0;
  for (const char of ulid.slice(0, TIME_LENGTH)) {
    const digit = CROCKFORD.indexOf(char);
    if (digit < 0) throw new Error('ulid_caractere_invalide');
    value = value * 32 + digit;
  }
  return value;
};
