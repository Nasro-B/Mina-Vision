import { createHash, randomBytes } from 'node:crypto';
import { encodeChatPayloadV2 } from '../contracts/chat-payload.mjs';
import {
  VOICE_CHUNK_BYTES,
  VOICE_MAX_BYTES,
  VOICE_PCM_MIME,
  isVoicePcmMime,
} from './voice-pcm.mjs';

// Découpe un média (déjà normalisé : image recompressée / audio m4a) en un événement de métadonnées
// + N chunks binaires, prêts à chiffrer et envoyer sur le canal `mina_app`. Symétrique exact du
// réassembleur (media-assembler) : chunk() puis assemble() redonne les octets d'origine. Sert au
// sens PC → téléphone (W6) et de référence pour le chunker Android (W3).

const DEFAULT_CHUNK_BYTES = 131_072; // 128 Kio (sous le plafond ciphertext de l'enveloppe)
const DEFAULT_MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MIME_TO_TYPE = Object.freeze({
  'image/jpeg': 'message.attachment.created',
  'image/png': 'message.attachment.created',
  'image/webp': 'message.attachment.created',
  'audio/mp4': 'message.voice.created',
  [VOICE_PCM_MIME]: 'message.voice.created',
});

const newMediaId = () => randomBytes(16).toString('hex'); // 32 hex, conforme à MEDIA_ID de l'assembleur

/**
 * @param {Buffer} bytes          contenu déjà normalisé
 * @param {object} opts
 * @param {string} opts.mime      un mime de MIME_TO_TYPE
 * @param {number} [opts.chunkBytes]
 * @param {number} [opts.maxTotalBytes]
 * @param {object} [opts.extraMeta]  ex. { width, height } pour une image, { durationMs } pour l'audio
 * @param {Function} [opts.makeId]
 * @returns {{ eventType, meta, chunks:Array<{index:number, binary:Buffer}> }}
 */
export function chunkMedia(bytes, {
  mime,
  chunkBytes = null,
  maxTotalBytes = null,
  extraMeta = {},
  makeId = newMediaId,
} = {}) {
  const buffer = Buffer.from(bytes ?? []);
  const eventType = MIME_TO_TYPE[mime];
  const voicePcm = isVoicePcmMime(mime);
  const resolvedChunkBytes = chunkBytes ?? (voicePcm ? VOICE_CHUNK_BYTES : DEFAULT_CHUNK_BYTES);
  const requestedMaxTotalBytes = maxTotalBytes ?? (voicePcm ? VOICE_MAX_BYTES : DEFAULT_MAX_TOTAL_BYTES);
  const resolvedMaxTotalBytes = voicePcm
    ? Math.min(requestedMaxTotalBytes, VOICE_MAX_BYTES)
    : requestedMaxTotalBytes;
  if (!eventType) throw new Error(`media_mime_refuse:${mime}`);
  if (buffer.length < 1) throw new Error('media_vide');
  if (buffer.length > resolvedMaxTotalBytes) throw new Error('media_trop_gros');
  if (!Number.isInteger(resolvedChunkBytes) || resolvedChunkBytes < 1 || resolvedChunkBytes > (voicePcm ? VOICE_CHUNK_BYTES : DEFAULT_CHUNK_BYTES)) throw new Error('media_chunk_bytes_invalide');

  const mediaId = makeId();
  const chunkCount = Math.ceil(buffer.length / resolvedChunkBytes);
  const chunks = [];
  for (let index = 0; index < chunkCount; index += 1) {
    chunks.push({ index, binary: Buffer.from(buffer.subarray(index * resolvedChunkBytes, (index + 1) * resolvedChunkBytes)) });
  }
  const meta = Object.freeze({
    mediaId,
    mime,
    sizeBytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    chunkCount,
    chunkBytes: resolvedChunkBytes,
    ...extraMeta,
  });
  return Object.freeze({ eventType, meta, chunks: Object.freeze(chunks) });
}

/** Encode le payload v2 de l'événement métadonnées (à chiffrer ensuite). */
export function encodeMediaMetaPayload({ eventType, meta }) {
  return encodeChatPayloadV2({ type: eventType, meta });
}

/** Encode le payload v2 d'un chunk (à chiffrer ensuite). */
export function encodeMediaChunkPayload({ mediaId, index, binary }) {
  return encodeChatPayloadV2({ type: 'media.chunk', meta: { mediaId, index }, binary });
}

export { DEFAULT_CHUNK_BYTES };
