// Chiffrement bout-en-bout du chat natif (Task 3).
//
// Modèle de clés :
//   - une clé de conversation AES-256 par ÉPOQUE (`keyEpoch`) ; le PC la génère et la tourne ;
//   - chaque appareil possède une `deviceWrapKey` distincte qui sert UNIQUEMENT à recevoir la
//     clé d'époque enveloppée. Une révocation crée une nouvelle époque : l'appareil retiré ne
//     peut plus lire les événements FUTURS (on ne prétend pas effacer ce qu'il a déjà lu).
//
// L'AAD lie chaque ciphertext à son contexte exact (expéditeur, fil, époque, dates) : déplacer
// un message chiffré vers un autre en-tête casse le déchiffrement au lieu de passer inaperçu.

import { createCipheriv, createDecipheriv, createSign, createVerify, hkdfSync, randomBytes } from 'node:crypto';
import { encodeChatHeader, encodeChatSignatureInput } from '../contracts/chat-binary-codec.mjs';

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const EPOCH_WRAP_PREFIX = 'MINA_EPOCH_WRAP_V1';
const ATTACHMENT_INFO = 'mina-chat-attachment-v1';

const requireKey = (value, label) => {
  const key = Buffer.from(value ?? []);
  if (key.length !== KEY_BYTES) throw new TypeError(`${label}_doit_faire_32_octets`);
  return key;
};

/** Clé de pièce jointe dérivée de l'époque : une pièce compromise n'expose pas les autres. */
export const deriveAttachmentKey = ({ epochKey, attachmentId }) => Buffer.from(hkdfSync(
  'sha256',
  requireKey(epochKey, 'epoch_key'),
  Buffer.from(String(attachmentId), 'utf8'),
  Buffer.from(ATTACHMENT_INFO, 'utf8'),
  KEY_BYTES,
));

// AAD binaire domain-separated pour l'enveloppement d'une clé d'époque : la clé enveloppée
// n'est déchiffrable que pour CE couple (appareil, époque).
function epochWrapAad({ deviceId, keyEpoch }) {
  const device = Buffer.from(String(deviceId), 'utf8');
  const header = Buffer.allocUnsafe(4 + 4);
  header.writeUInt32BE(device.length, 0);
  header.writeUInt32BE(Number(keyEpoch), 4);
  return Buffer.concat([Buffer.from(EPOCH_WRAP_PREFIX, 'ascii'), Buffer.from([0]), header, device]);
}

export function wrapEpochKey({ deviceWrapKey, epochKey, deviceId, keyEpoch }) {
  const wrapKey = requireKey(deviceWrapKey, 'device_wrap_key');
  const key = requireKey(epochKey, 'epoch_key');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, wrapKey, nonce);
  cipher.setAAD(epochWrapAad({ deviceId, keyEpoch }));
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
  key.fill(0);
  return Object.freeze({
    keyEpoch: Number(keyEpoch),
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  });
}

export function unwrapEpochKey({ deviceWrapKey, wrapped, deviceId, keyEpoch }) {
  const wrapKey = requireKey(deviceWrapKey, 'device_wrap_key');
  const decipher = createDecipheriv(ALGORITHM, wrapKey, Buffer.from(wrapped.nonce, 'base64'));
  decipher.setAAD(epochWrapAad({ deviceId, keyEpoch }));
  decipher.setAuthTag(Buffer.from(wrapped.authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(wrapped.ciphertext, 'base64')), decipher.final()]);
}

export function createChatCrypto({ signingPrivateKey, verifyPublicKey, epochKey } = {}) {
  const key = requireKey(epochKey, 'epoch_key');

  return Object.freeze({
    /**
     * Chiffre puis signe. L'ordre compte : on signe le CIPHERTEXT, jamais le clair — la
     * signature prouve l'origine sans qu'un vérificateur ait besoin de déchiffrer.
     */
    encryptAndSign({ header, plaintext }) {
      if (!signingPrivateKey) throw new TypeError('signing_private_key_requise');
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, nonce);
      cipher.setAAD(encodeChatHeader({ ...header, version: header.version ?? 2 }));
      const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
      const event = {
        ...header,
        version: header.version ?? 2,
        payloadCiphertext: ciphertext.toString('base64'),
        nonce: nonce.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
      };
      const signature = createSign('sha256')
        .update(encodeChatSignatureInput({ ...event, signature: '' }))
        .sign({ key: signingPrivateKey, dsaEncoding: 'der' });
      return Object.freeze({ ...event, signature: signature.toString('base64') });
    },

    /**
     * Vérifie PUIS déchiffre — jamais l'inverse. Déchiffrer un contenu non authentifié
     * reviendrait à traiter des octets d'origine inconnue.
     */
    verifyAndDecrypt(event) {
      if (!verifyPublicKey) throw new TypeError('verify_public_key_requise');
      const signature = Buffer.from(event.signature, 'base64');
      const valid = createVerify('sha256')
        .update(encodeChatSignatureInput({ ...event, signature: '' }))
        .verify({ key: verifyPublicKey, dsaEncoding: 'der' }, signature);
      if (!valid) throw new Error('chat_signature_invalide');

      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(event.nonce, 'base64'));
      decipher.setAAD(encodeChatHeader(event));
      decipher.setAuthTag(Buffer.from(event.authTag, 'base64'));
      try {
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(event.payloadCiphertext, 'base64')),
          decipher.final(),
        ]);
        return plaintext.toString('utf8');
      } catch {
        // Tag invalide OU contexte modifié (AAD) : dans les deux cas, contenu non fiable.
        throw new Error('chat_dechiffrement_impossible');
      }
    },
  });
}

export const CHAT_CRYPTO_CONSTANTS = Object.freeze({
  ALGORITHM, NONCE_BYTES, TAG_BYTES, KEY_BYTES, EPOCH_WRAP_PREFIX, ATTACHMENT_INFO,
});
