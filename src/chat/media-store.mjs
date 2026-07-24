import { createAad, decryptAead, encryptAead } from '../crypto/aead.mjs';

// Stockage AU REPOS des médias reçus (pièces jointes, notes vocales), CHIFFRÉ (décision P6 du plan
// extras chat) : aucun média en clair sur le disque, d'aucun côté. Chaque média est chiffré
// AES-256-GCM avec une clé dédiée (dérivée HKDF de la clé maître par l'appelant, jamais la clé
// maître elle-même), lié par AAD à son mediaId. Écriture atomique. Best-effort à la lecture : un
// fichier absent/altéré rend null plutôt que de crasher.

const MEDIA_ID = /^[A-Za-z0-9._:-]{1,64}$/u;

export function createMediaStore({ directory, key, writeFile, readFile, rename, mkdir, now = Date.now } = {}) {
  if (!directory || typeof writeFile !== 'function' || typeof readFile !== 'function') {
    throw new TypeError('media_store_dependencies_required');
  }
  const wrapKey = Buffer.from(key ?? []);
  if (wrapKey.length !== 32) throw new TypeError('media_store_key_invalid');

  const pathFor = (mediaId) => `${directory}/${mediaId}.media`;

  return Object.freeze({
    async save(mediaId, mime, bytes) {
      if (!MEDIA_ID.test(mediaId ?? '')) throw new Error('media_id_invalide');
      await mkdir?.(directory, { recursive: true });
      const aad = createAad({ version: 1, type: 'chat_media', id: mediaId });
      const envelope = encryptAead({ key: wrapKey, plaintext: Buffer.from(bytes), aad });
      const record = JSON.stringify({ mime: String(mime), envelope });
      const target = pathFor(mediaId);
      const tmp = `${target}.${now()}.tmp`;
      await writeFile(tmp, record, 'utf8');
      if (typeof rename === 'function') await rename(tmp, target);
      else await writeFile(target, record, 'utf8');
      return Object.freeze({ mediaId, stored: true });
    },

    async load(mediaId) {
      if (!MEDIA_ID.test(mediaId ?? '')) return null;
      let record;
      try {
        record = JSON.parse(await readFile(pathFor(mediaId), 'utf8'));
      } catch {
        return null;
      }
      try {
        const aad = createAad({ version: 1, type: 'chat_media', id: mediaId });
        const bytes = decryptAead({ key: wrapKey, envelope: record.envelope, aad });
        return Object.freeze({ mediaId, mime: String(record.mime), bytes });
      } catch {
        return null; // altéré ou mauvaise clé : jamais un octet en clair douteux rendu
      }
    },
  });
}
