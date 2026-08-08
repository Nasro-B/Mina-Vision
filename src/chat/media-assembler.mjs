import { createHash } from 'node:crypto';
import {
  VOICE_CHUNK_BYTES,
  VOICE_MAX_BYTES,
  VOICE_PCM_MIME,
  isVoicePcmMime,
} from './voice-pcm.mjs';

// Réassemblage des pièces jointes/notes vocales reçues par chunks (extras chat). Reçoit un
// événement `message.attachment.created`/`message.voice.created` (métadonnées + digest) puis des
// `media.chunk` (binaire découpé). Sécurité-critique : toutes les gardes AVANT toute allocation.
//
//   • liste blanche de mimes (jamais un type inattendu),
//   • borne DURE chunkCount × chunkBytes ≤ maxTotalBytes vérifiée AVANT d'accepter le moindre chunk,
//   • chunks tolérants au désordre, mais index borné et pas de doublon,
//   • à la complétion : sha256 du clair réassemblé == digest annoncé, taille == taille annoncée,
//     sinon rejet TOTAL (jamais un média corrompu rendu),
//   • purge des médias incomplets après un délai (pas de fuite mémoire).

const DEFAULT_MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5 Mo (plan A2)
const DEFAULT_MIME_ALLOWLIST = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'audio/mp4', VOICE_PCM_MIME]);
const DEFAULT_INCOMPLETE_TTL_MS = 10 * 60_000;
const MAX_CHUNK_BYTES = 131_072;
const MEDIA_ID = /^[A-Za-z0-9._:-]{1,64}$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;

export function createMediaAssembler({
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  maxVoiceBytes = VOICE_MAX_BYTES,
  mimeAllowlist = DEFAULT_MIME_ALLOWLIST,
  incompleteTtlMs = DEFAULT_INCOMPLETE_TTL_MS,
  now = Date.now,
} = {}) {
  const allow = new Set(mimeAllowlist);
  const pending = new Map(); // mediaId → { meta, chunks: Map<index, Buffer>, received, startedAt }

  function purgeExpired(nowMs) {
    for (const [mediaId, entry] of pending) {
      if (nowMs - entry.startedAt > incompleteTtlMs) pending.delete(mediaId);
    }
  }

  return Object.freeze({
    /** Déclare une pièce jointe entrante. Rejette AVANT toute allocation si les gardes ne passent pas. */
    begin(meta = {}) {
      const { mediaId, mime, sizeBytes, sha256, chunkCount, chunkBytes } = meta;
      const voicePcm = isVoicePcmMime(mime);
      if (!MEDIA_ID.test(mediaId ?? '')) throw new Error('media_id_invalide');
      if (!allow.has(mime)) throw new Error(`media_mime_refuse:${mime}`);
      if (!SHA256_HEX.test(sha256 ?? '')) throw new Error('media_digest_invalide');
      if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 4096) throw new Error('media_chunk_count_invalide');
      if (!Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > (voicePcm ? VOICE_CHUNK_BYTES : MAX_CHUNK_BYTES)) throw new Error('media_chunk_bytes_invalide');
      if (!Number.isInteger(sizeBytes) || sizeBytes < 1) throw new Error('media_size_invalide');
      const maxBytes = voicePcm ? Math.min(maxVoiceBytes, VOICE_MAX_BYTES) : maxTotalBytes;
      if (sizeBytes > maxBytes) throw new Error('media_taille_invalide');
      // Les images conservent la borne théorique historique. Pour la voix, le dernier chunk peut
      // être plus court que 32 000 octets, donc il existe au plus un chunk de marge.
      if (!voicePcm && chunkCount * chunkBytes > maxBytes) throw new Error('media_trop_gros');
      const expectedChunkCount = Math.ceil(sizeBytes / chunkBytes);
      if (chunkCount !== expectedChunkCount) throw new Error('media_chunk_count_invalide');
      if (voicePcm && chunkCount * chunkBytes > maxBytes + VOICE_CHUNK_BYTES - 1) throw new Error('media_trop_gros');
      purgeExpired(now());
      if (!pending.has(mediaId)) {
        pending.set(mediaId, { meta: Object.freeze({ ...meta }), chunks: new Map(), received: 0, startedAt: now() });
      }
      return Object.freeze({ mediaId, awaiting: chunkCount });
    },

    /** Ajoute un chunk. Tolère le désordre, refuse index hors bornes/doublon. Retourne l'état. */
    addChunk({ mediaId, index, binary } = {}) {
      const entry = pending.get(mediaId);
      if (!entry) throw new Error('media_inconnu'); // chunk avant meta OU média déjà finalisé/purgé
      if (!Number.isInteger(index) || index < 0 || index >= entry.meta.chunkCount) throw new Error('media_index_invalide');
      const bytes = Buffer.from(binary ?? []);
      const expectedBytes = Math.min(
        entry.meta.chunkBytes,
        entry.meta.sizeBytes - (index * entry.meta.chunkBytes),
      );
      if (bytes.length !== expectedBytes) throw new Error('media_chunk_taille_invalide');
      if (entry.chunks.has(index)) return Object.freeze({ mediaId, complete: false, duplicate: true });
      entry.chunks.set(index, bytes);
      entry.received += 1;
      return Object.freeze({ mediaId, complete: entry.received === entry.meta.chunkCount, duplicate: false });
    },

    isComplete(mediaId) {
      const entry = pending.get(mediaId);
      return Boolean(entry && entry.received === entry.meta.chunkCount);
    },

    /**
     * Assemble le média complet. Vérifie digest ET taille, sinon rejet TOTAL. Consomme l'entrée
     * (le média est retiré du tampon après finalisation, réussie ou non).
     */
    finalize(mediaId) {
      const entry = pending.get(mediaId);
      if (!entry) throw new Error('media_inconnu');
      if (entry.received !== entry.meta.chunkCount) throw new Error('media_incomplet');
      pending.delete(mediaId);
      const ordered = [];
      for (let i = 0; i < entry.meta.chunkCount; i += 1) {
        const chunk = entry.chunks.get(i);
        if (!chunk) throw new Error('media_chunk_manquant'); // ne devrait pas arriver (received compté)
        ordered.push(chunk);
      }
      const bytes = Buffer.concat(ordered);
      if (bytes.length !== entry.meta.sizeBytes) throw new Error('media_taille_mismatch');
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== entry.meta.sha256) throw new Error('media_digest_mismatch');
      return Object.freeze({ mediaId, mime: entry.meta.mime, bytes, sizeBytes: bytes.length });
    },

    /** Abandonne un média (révocation, timeout applicatif). */
    drop(mediaId) { return pending.delete(mediaId); },

    pendingCount() { purgeExpired(now()); return pending.size; },
  });
}

export { DEFAULT_MIME_ALLOWLIST, DEFAULT_MAX_TOTAL_BYTES };
