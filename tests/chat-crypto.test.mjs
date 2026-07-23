import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createChatCrypto, deriveAttachmentKey, unwrapEpochKey, wrapEpochKey,
} from '../src/devices/chat-crypto.mjs';
import { parseChatEvent } from '../src/contracts/chat.mjs';

const keyPair = () => generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const header = (overrides = {}) => ({
  version: 2,
  eventId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  threadId: 'thread-main',
  senderDeviceId: 'device-samsung',
  deviceSequence: 1,
  keyEpoch: 1,
  routingClass: 'message',
  createdAtMs: 1_784_732_400_000,
  expiresAtMs: 1_787_324_400_000,
  ...overrides,
});

describe('crypto par époque du chat', () => {
  it('chiffre, signe, vérifie et déchiffre un aller-retour complet', () => {
    const { privateKey, publicKey } = keyPair();
    const epochKey = randomBytes(32);
    const crypto = createChatCrypto({ signingPrivateKey: privateKey, verifyPublicKey: publicKey, epochKey });

    const event = crypto.encryptAndSign({ header: header(), plaintext: 'bonjour Mina' });
    // L'événement produit doit satisfaire le contrat public sans retouche.
    expect(() => parseChatEvent(event)).not.toThrow();
    expect(crypto.verifyAndDecrypt(event)).toBe('bonjour Mina');
  });

  it('le clair n\'apparaît JAMAIS dans l\'événement transporté', () => {
    const { privateKey, publicKey } = keyPair();
    const crypto = createChatCrypto({ signingPrivateKey: privateKey, verifyPublicKey: publicKey, epochKey: randomBytes(32) });
    const secret = 'numéro de carte 4111 1111 1111 1111';
    const event = crypto.encryptAndSign({ header: header(), plaintext: secret });
    expect(JSON.stringify(event)).not.toContain(secret);
    expect(Buffer.from(event.payloadCiphertext, 'base64').toString('utf8')).not.toContain('carte');
  });

  it('refuse une signature falsifiée AVANT toute tentative de déchiffrement', () => {
    const { privateKey, publicKey } = keyPair();
    const other = keyPair();
    const epochKey = randomBytes(32);
    const crypto = createChatCrypto({ signingPrivateKey: privateKey, verifyPublicKey: publicKey, epochKey });
    const event = crypto.encryptAndSign({ header: header(), plaintext: 'message' });

    const foreign = createChatCrypto({ signingPrivateKey: other.privateKey, verifyPublicKey: publicKey, epochKey });
    const forged = foreign.encryptAndSign({ header: header(), plaintext: 'message falsifié' });
    expect(() => crypto.verifyAndDecrypt(forged)).toThrow('chat_signature_invalide');
  });

  it('détecte toute altération du CONTEXTE (AAD), pas seulement du contenu', () => {
    const { privateKey, publicKey } = keyPair();
    const epochKey = randomBytes(32);
    const crypto = createChatCrypto({ signingPrivateKey: privateKey, verifyPublicKey: publicKey, epochKey });
    const event = crypto.encryptAndSign({ header: header(), plaintext: 'message' });

    // Déplacer un message vers un autre fil doit casser — pas passer inaperçu.
    for (const patch of [
      { threadId: 'thread-autre' },
      { senderDeviceId: 'device-attaquant' },
      { deviceSequence: 99 },
      { keyEpoch: 2 },
      { createdAtMs: header().createdAtMs + 1 },
    ]) {
      expect(() => crypto.verifyAndDecrypt({ ...event, ...patch })).toThrow(/chat_signature_invalide|chat_dechiffrement_impossible/u);
    }
  });

  it('refuse un ciphertext modifié (tag GCM)', () => {
    const { privateKey, publicKey } = keyPair();
    const epochKey = randomBytes(32);
    const crypto = createChatCrypto({ signingPrivateKey: privateKey, verifyPublicKey: publicKey, epochKey });
    const event = crypto.encryptAndSign({ header: header(), plaintext: 'message' });
    const bytes = Buffer.from(event.payloadCiphertext, 'base64');
    bytes[0] ^= 0xff;
    expect(() => crypto.verifyAndDecrypt({ ...event, payloadCiphertext: bytes.toString('base64') }))
      .toThrow(/chat_signature_invalide|chat_dechiffrement_impossible/u);
  });

  it('une AUTRE époque ne peut pas lire le message — base de la révocation', () => {
    const { privateKey, publicKey } = keyPair();
    const crypto = createChatCrypto({ signingPrivateKey: privateKey, verifyPublicKey: publicKey, epochKey: randomBytes(32) });
    const event = crypto.encryptAndSign({ header: header(), plaintext: 'secret' });
    const revoked = createChatCrypto({ signingPrivateKey: privateKey, verifyPublicKey: publicKey, epochKey: randomBytes(32) });
    expect(() => revoked.verifyAndDecrypt(event)).toThrow('chat_dechiffrement_impossible');
  });
});

describe('enveloppement des clés d\'époque', () => {
  it('enveloppe et désenveloppe pour le bon appareil et la bonne époque', () => {
    const deviceWrapKey = randomBytes(32);
    const epochKey = randomBytes(32);
    const wrapped = wrapEpochKey({ deviceWrapKey, epochKey: Buffer.from(epochKey), deviceId: 'device-samsung', keyEpoch: 1 });
    const opened = unwrapEpochKey({ deviceWrapKey, wrapped, deviceId: 'device-samsung', keyEpoch: 1 });
    expect(opened.equals(epochKey)).toBe(true);
    expect(wrapped.ciphertext).not.toContain(epochKey.toString('base64'));
  });

  it('refuse un autre appareil ou une autre époque (AAD lié)', () => {
    const deviceWrapKey = randomBytes(32);
    const wrapped = wrapEpochKey({ deviceWrapKey, epochKey: randomBytes(32), deviceId: 'device-samsung', keyEpoch: 1 });
    expect(() => unwrapEpochKey({ deviceWrapKey, wrapped, deviceId: 'device-huawei', keyEpoch: 1 })).toThrow();
    expect(() => unwrapEpochKey({ deviceWrapKey, wrapped, deviceId: 'device-samsung', keyEpoch: 2 })).toThrow();
    expect(() => unwrapEpochKey({ deviceWrapKey: randomBytes(32), wrapped, deviceId: 'device-samsung', keyEpoch: 1 })).toThrow();
  });

  it('exige des clés de 32 octets — jamais de clé faible acceptée en silence', () => {
    expect(() => wrapEpochKey({ deviceWrapKey: randomBytes(16), epochKey: randomBytes(32), deviceId: 'd', keyEpoch: 1 }))
      .toThrow('device_wrap_key_doit_faire_32_octets');
    expect(() => wrapEpochKey({ deviceWrapKey: randomBytes(32), epochKey: randomBytes(16), deviceId: 'd', keyEpoch: 1 }))
      .toThrow('epoch_key_doit_faire_32_octets');
  });
});

describe('clés de pièces jointes', () => {
  it('dérive une clé distincte par pièce jointe, déterministe', () => {
    const epochKey = randomBytes(32);
    const first = deriveAttachmentKey({ epochKey, attachmentId: 'att-1' });
    const second = deriveAttachmentKey({ epochKey, attachmentId: 'att-2' });
    expect(first.length).toBe(32);
    expect(first.equals(second)).toBe(false);
    // Déterminisme : le destinataire dérive la même clé sans échange supplémentaire.
    expect(deriveAttachmentKey({ epochKey, attachmentId: 'att-1' }).equals(first)).toBe(true);
  });

  it('une autre époque donne une autre clé de pièce jointe', () => {
    const first = deriveAttachmentKey({ epochKey: randomBytes(32), attachmentId: 'att-1' });
    const second = deriveAttachmentKey({ epochKey: randomBytes(32), attachmentId: 'att-1' });
    expect(first.equals(second)).toBe(false);
  });
});
