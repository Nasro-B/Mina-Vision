// Couche 2 du journal d'activité (Task 5) : le texte intégral expurgé de la couche 1 (JSONL en
// clair) est conservé ICI, chiffré AES-256-GCM avec une clé dérivée du coffre. Tant que la clé
// n'est pas fournie (coffre verrouillé), les textes s'accumulent dans un tampon mémoire borné
// puis sont chiffrés d'un bloc au déverrouillage — jamais écrits en clair sur le disque.
// La jointure couche 1 ↔ couche 2 se fait par digest sha256 du texte.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const DAY_MS = 86_400_000;
const RETENTION_DAYS = 7;
const MAX_PENDING_WHILE_LOCKED = 200;
const ALGORITHM = 'aes-256-gcm';

const dayStamp = (ms) => new Date(ms).toISOString().slice(0, 10);

export function createSensitiveJournalStore({
  directory,
  appendFile,
  readFile,
  readdir,
  rm,
  mkdir,
  now = Date.now,
  retentionDays = RETENTION_DAYS,
} = {}) {
  if (!directory || typeof appendFile !== 'function' || typeof readFile !== 'function'
    || typeof readdir !== 'function' || typeof rm !== 'function' || typeof mkdir !== 'function') {
    throw new TypeError('sensitive_journal_dependencies_required');
  }
  const filenameFor = (ms) => `${directory}/journal-sensible-${dayStamp(ms)}.jsonl`;
  let key = null;
  let pendingWhileLocked = [];
  let dropped = 0;
  let ready = null;
  let writing = Promise.resolve();
  const ensureDirectory = () => {
    ready ??= mkdir(directory, { recursive: true }).catch(() => {});
    return ready;
  };

  function encryptLine({ at, kind, digest, text }) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, nonce);
    const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const line = JSON.stringify({
      at,
      kind,
      digest,
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    });
    return `${line}\n`;
  }

  function writeEncrypted(entry) {
    const line = encryptLine(entry);
    writing = writing
      .then(() => ensureDirectory())
      .then(() => appendFile(filenameFor(entry.at), line, 'utf8'))
      .catch(() => {});
    return writing;
  }

  return Object.freeze({
    // Fire-and-forget, comme la couche 1 : ne ralentit ni ne casse jamais l'app.
    store(entry) {
      if (!entry || typeof entry.text !== 'string' || !entry.text || typeof entry.digest !== 'string') return;
      if (key) {
        void writeEncrypted(entry);
        return;
      }
      if (pendingWhileLocked.length >= MAX_PENDING_WHILE_LOCKED) {
        dropped += 1;
        return;
      }
      pendingWhileLocked.push({ ...entry });
    },

    // Appelé au déverrouillage du coffre avec une clé 32 octets DÉDIÉE (dérivée HKDF, jamais la
    // clé maître elle-même). Vide le tampon accumulé pendant le verrouillage.
    enableEncryption(derivedKey) {
      const buffer = Buffer.from(derivedKey ?? []);
      if (buffer.length !== 32) throw new TypeError('sensitive_journal_key_invalid');
      key = buffer;
      const backlog = pendingWhileLocked;
      pendingWhileLocked = [];
      for (const entry of backlog) void writeEncrypted(entry);
      return { flushed: backlog.length, dropped };
    },

    isUnlocked: () => key !== null,

    // Textes par digest, sur aujourd'hui + hier (même fenêtre que la lecture couche 1).
    async read({ digests } = {}) {
      const wanted = Array.isArray(digests) && digests.length > 0 ? new Set(digests) : null;
      const texts = new Map();
      if (!key) return texts;
      const at = Number(now());
      for (const ms of [at, at - DAY_MS]) {
        const content = await readFile(filenameFor(ms), 'utf8').catch(() => '');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (wanted && !wanted.has(parsed.digest)) continue;
            const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(parsed.nonce, 'base64'));
            decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
            const text = Buffer.concat([
              decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
              decipher.final(),
            ]).toString('utf8');
            texts.set(parsed.digest, text);
          } catch { /* ligne corrompue ou clé changée : ignorée, jamais fatale */ }
        }
      }
      return texts;
    },

    async purge() {
      const names = await readdir(directory).catch(() => []);
      const cutoff = dayStamp(Number(now()) - retentionDays * DAY_MS);
      let removed = 0;
      for (const name of names) {
        const match = /^journal-sensible-(\d{4}-\d{2}-\d{2})\.jsonl$/u.exec(name);
        if (!match || match[1] >= cutoff) continue;
        await rm(`${directory}/${name}`).catch(() => {});
        removed += 1;
      }
      return { removed };
    },
  });
}
