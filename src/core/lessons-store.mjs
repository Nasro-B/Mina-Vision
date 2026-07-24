import { createAad, decryptAead, encryptAead } from '../crypto/aead.mjs';

// Persistance CHIFFRÉE du registre de leçons (décision L4 : coffre chiffré). Le blob serialize()
// est chiffré AES-256-GCM avec une clé dérivée de la clé maître (jamais la clé maître elle-même —
// même principe que le journal couche 2). Écriture atomique. Best-effort : une panne disque ne
// casse jamais le runtime — au pire une leçon n'est pas encore persistée et se réapprendra.

const AAD = createAad({ version: 1, type: 'lessons_registry', id: 'owner' });

export function createLessonsStore({ filePath, key, readFile, writeFile, rename, now = Date.now } = {}) {
  if (!filePath || typeof readFile !== 'function' || typeof writeFile !== 'function') {
    throw new TypeError('lessons_store_dependencies_required');
  }
  const wrapKey = Buffer.from(key ?? []);
  if (wrapKey.length !== 32) throw new TypeError('lessons_store_key_invalid');
  let writing = Promise.resolve();

  return Object.freeze({
    // Charge et déchiffre le blob ; retourne la chaîne serialize() ou null (fichier absent/altéré).
    async load() {
      let envelope;
      try {
        envelope = JSON.parse(await readFile(filePath, 'utf8'));
      } catch {
        return null; // absent = pas encore de leçons persistées
      }
      try {
        return decryptAead({ key: wrapKey, envelope, aad: AAD }).toString('utf8');
      } catch {
        return null; // altéré/mauvaise clé : on repart proprement, jamais crasher
      }
    },

    // Chiffre et écrit le blob de façon atomique et séquencée (best-effort).
    save(serialized) {
      const envelope = encryptAead({ key: wrapKey, plaintext: Buffer.from(String(serialized), 'utf8'), aad: AAD });
      const tmp = `${filePath}.${now()}.tmp`;
      writing = writing
        .then(async () => {
          await writeFile(tmp, JSON.stringify(envelope), 'utf8');
          if (typeof rename === 'function') await rename(tmp, filePath);
          else await writeFile(filePath, JSON.stringify(envelope), 'utf8');
        })
        .catch(() => {});
      return writing;
    },
  });
}
