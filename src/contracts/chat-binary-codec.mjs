// Encodage binaire CANONIQUE des événements du chat — la référence partagée Node ↔ Kotlin.
//
// Pourquoi pas JSON.stringify : l'ordre des clés d'un objet JSON n'est pas garanti entre
// plateformes, et une simple différence d'espacement changerait les octets signés. Une
// signature ne vaut que si les DEUX camps calculent exactement les mêmes octets — d'où ce
// format binaire à longueurs préfixées, domain-separated, testé par vecteurs communs.

const AAD_PREFIX = 'MINA_CHAT_EVENT_V2\0';
const SIGNATURE_PREFIX = 'MINA_CHAT_SIGNATURE_V1\0';
const MAX_FIELD_BYTES = 4096;

const uint16 = (value) => {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
};

const uint32 = (value) => {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
};

const uint64 = (value) => {
  const buffer = Buffer.allocUnsafe(8);
  buffer.writeBigUInt64BE(BigInt(value), 0);
  return buffer;
};

// Chaîne préfixée de sa longueur UTF-8 : impossible de confondre deux champs voisins en
// déplaçant une frontière (« ab|c » vs « a|bc » produiraient des octets différents).
const lengthPrefixedUtf8 = (value) => {
  const bytes = Buffer.from(String(value), 'utf8');
  if (bytes.length > MAX_FIELD_BYTES) throw new Error('chat_codec_champ_trop_long');
  return Buffer.concat([uint32(bytes.length), bytes]);
};

const lengthPrefixedBytes = (bytes) => Buffer.concat([uint32(bytes.length), bytes]);

// AAD : les données AUTHENTIFIÉES mais non chiffrées. Elles lient le ciphertext à son
// contexte exact — changer l'expéditeur, le fil ou l'époque invalide le déchiffrement.
export function encodeChatHeader(event) {
  return Buffer.concat([
    Buffer.from(AAD_PREFIX, 'ascii'),
    uint16(event.version),
    lengthPrefixedUtf8(event.eventId),
    lengthPrefixedUtf8(event.threadId),
    lengthPrefixedUtf8(event.senderDeviceId),
    uint64(event.deviceSequence),
    uint32(event.keyEpoch),
    lengthPrefixedUtf8(event.routingClass),
    uint64(event.createdAtMs),
    uint64(event.expiresAtMs),
  ]);
}

// Entrée de signature : l'AAD complet PLUS le ciphertext, le nonce et le tag. Signer aussi le
// ciphertext empêche de recoller un contenu valide sur un en-tête d'un autre événement.
export function encodeChatSignatureInput(event) {
  const header = encodeChatHeader(event);
  return Buffer.concat([
    Buffer.from(SIGNATURE_PREFIX, 'ascii'),
    lengthPrefixedBytes(header),
    lengthPrefixedBytes(Buffer.from(event.nonce, 'base64')),
    lengthPrefixedBytes(Buffer.from(event.payloadCiphertext, 'base64')),
    lengthPrefixedBytes(Buffer.from(event.authTag, 'base64')),
  ]);
}

export const CHAT_AAD_PREFIX = AAD_PREFIX;
export const CHAT_SIGNATURE_PREFIX = SIGNATURE_PREFIX;
