// Codec du PAYLOAD déchiffré du canal `mina_app` (extras chat : pièces jointes, notes vocales).
//
// Le payload v1 historique est du TEXTE BRUT UTF-8 nu (ChatRepository.sendText l'envoie ainsi). On
// NE LE TOUCHE JAMAIS : un texte v1 reste décodé tel quel. Les nouveaux types (pièce jointe, chunk
// binaire) utilisent un format v2 AUTO-DESCRIPTIF, distinguable par son PREMIER OCTET :
//
//   Octet 0 : 0x00                       ← discriminateur. Un texte UTF-8 non vide ne commence jamais
//                                          par NUL (le contrat d'enveloppe rejette déjà les NUL, et
//                                          l'émission texte l'impose). Donc 0x00 ⇒ payload v2.
//   Octet 1 : 0x02                       ← version du payload
//   uint16(BE) len | type UTF-8          ← type d'événement, ex. "message.attachment.created"
//   uint32(BE) len | meta JSON UTF-8     ← métadonnées canoniques
//   uint32(BE) len | binaire             ← section binaire (vide sauf media.chunk)
//
// Miroir EXACT de core/protocol/ChatPayloadCodec.kt, vérifié par le vecteur partagé
// tests/fixtures/protocol/mina-chat-payload-v2-vectors.json. Big-endian pour coller à ByteBuffer.

export const PAYLOAD_V2_VERSION = 2;
const MAX_TYPE_BYTES = 160;
const MAX_META_BYTES = 8 * 1024;
const MAX_BINARY_BYTES = 131_072; // 128 Kio par chunk (sous le plafond ciphertext de l'enveloppe)

const PAYLOAD_TYPES = Object.freeze([
  'message.attachment.created',
  'message.voice.created',
  'media.chunk',
  'assistant.response.started',
  'assistant.response.chunk',
  'assistant.response.completed',
  'assistant.response.failed',
  // Appels (Vague 2 du plan appels) : le PC DEMANDE l'ouverture du composeur pré-rempli
  // (ACTION_DIAL, zéro permission) — l'humain appuie lui-même sur « appeler ». Jamais
  // d'appel lancé par programme : c'est le contrat D1/D4 (dial_only + confirmation humaine).
  'call.dial.requested',
]);

function readUint16(buffer, offset) {
  if (offset + 2 > buffer.length) throw new Error('chat_payload_tronque');
  return buffer.readUInt16BE(offset);
}
function readUint32(buffer, offset) {
  if (offset + 4 > buffer.length) throw new Error('chat_payload_tronque');
  return buffer.readUInt32BE(offset);
}

export function encodeChatPayloadV2({ type, meta = {}, binary = Buffer.alloc(0) } = {}) {
  if (!PAYLOAD_TYPES.includes(type)) throw new Error(`chat_payload_type_invalide:${type}`);
  const typeBytes = Buffer.from(type, 'utf8');
  const metaBytes = Buffer.from(JSON.stringify(meta), 'utf8');
  const binaryBytes = Buffer.from(binary);
  if (typeBytes.length > MAX_TYPE_BYTES) throw new Error('chat_payload_type_trop_long');
  if (metaBytes.length > MAX_META_BYTES) throw new Error('chat_payload_meta_trop_longue');
  if (binaryBytes.length > MAX_BINARY_BYTES) throw new Error('chat_payload_binaire_trop_long');

  const header = Buffer.from([0x00, PAYLOAD_V2_VERSION]);
  const typeLen = Buffer.alloc(2); typeLen.writeUInt16BE(typeBytes.length, 0);
  const metaLen = Buffer.alloc(4); metaLen.writeUInt32BE(metaBytes.length, 0);
  const binLen = Buffer.alloc(4); binLen.writeUInt32BE(binaryBytes.length, 0);
  return Buffer.concat([header, typeLen, typeBytes, metaLen, metaBytes, binLen, binaryBytes]);
}

/**
 * Décode un payload CLAIR. Rétrocompatible : premier octet ≠ 0x00 ⇒ texte v1 brut (chemin actuel,
 * inchangé). 0x00 ⇒ payload v2 typé.
 * @returns {{version:1, kind:'text', text:string} | {version:2, type:string, meta:object, binary:Buffer}}
 */
export function decodeChatPayload(input) {
  const buffer = Buffer.from(input);
  if (buffer.length === 0) return Object.freeze({ version: 1, kind: 'text', text: '' });
  if (buffer[0] !== 0x00) {
    return Object.freeze({ version: 1, kind: 'text', text: buffer.toString('utf8') });
  }
  if (buffer.length < 2 || buffer[1] !== PAYLOAD_V2_VERSION) throw new Error('chat_payload_version_inconnue');

  let offset = 2;
  const typeLen = readUint16(buffer, offset); offset += 2;
  if (typeLen > MAX_TYPE_BYTES || offset + typeLen > buffer.length) throw new Error('chat_payload_type_invalide');
  const type = buffer.subarray(offset, offset + typeLen).toString('utf8'); offset += typeLen;
  if (!PAYLOAD_TYPES.includes(type)) throw new Error(`chat_payload_type_invalide:${type}`);

  const metaLen = readUint32(buffer, offset); offset += 4;
  if (metaLen > MAX_META_BYTES || offset + metaLen > buffer.length) throw new Error('chat_payload_meta_invalide');
  let meta;
  try { meta = JSON.parse(buffer.subarray(offset, offset + metaLen).toString('utf8')); } catch { throw new Error('chat_payload_meta_json_invalide'); }
  offset += metaLen;

  const binLen = readUint32(buffer, offset); offset += 4;
  if (binLen > MAX_BINARY_BYTES || offset + binLen !== buffer.length) throw new Error('chat_payload_binaire_invalide');
  const binary = Buffer.from(buffer.subarray(offset, offset + binLen));

  return Object.freeze({ version: 2, type, meta: Object.freeze(meta), binary });
}

export { PAYLOAD_TYPES, MAX_BINARY_BYTES };
