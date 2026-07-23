// Identité cryptographique du PC pour le canal `mina_app`.
//
// C'est la clé qui prouve aux téléphones que « le PC » est bien celui qu'ils ont appairé. Elle
// est générée une fois, puis conservée CHIFFRÉE par une clé dérivée du coffre : coffre
// verrouillé, l'identité reste inaccessible — le canal ne peut donc pas prétendre être Mina.

import {
  createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IDENTITY_INFO = 'mina-chat-pc-identity-v1';
const NONCE_BYTES = 12;
const SCHEMA_VERSION = 1;

const identityKey = (masterKey) => Buffer.from(hkdfSync(
  'sha256',
  Buffer.from(masterKey),
  Buffer.from('mina-chat-pc-identity', 'utf8'),
  Buffer.from(IDENTITY_INFO, 'utf8'),
  32,
));

/**
 * Charge l'identité PC, ou la crée à la première utilisation.
 *
 * @param {object} options
 * @param {string} options.filePath
 * @param {Buffer} options.masterKey clé maîtresse du coffre (jamais utilisée telle quelle)
 * @param {(path: string, encoding: string) => Promise<string>} options.readFile
 * @param {(path: string, data: string) => Promise<void>} options.writeFile
 */
export async function loadOrCreatePcChatIdentity({ filePath, masterKey, readFile, writeFile } = {}) {
  if (!filePath) throw new TypeError('pc_chat_identity_chemin_requis');
  if (!masterKey) throw new Error('pc_chat_identity_coffre_verrouille');
  const key = identityKey(masterKey);

  const existing = await readFile(filePath, 'utf8').then(JSON.parse).catch(() => null);
  if (existing?.version === SCHEMA_VERSION && existing.ciphertext) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(existing.nonce, 'base64'));
      decipher.setAAD(Buffer.from(IDENTITY_INFO, 'utf8'));
      decipher.setAuthTag(Buffer.from(existing.authTag, 'base64'));
      const pkcs8 = Buffer.concat([
        decipher.update(Buffer.from(existing.ciphertext, 'base64')),
        decipher.final(),
      ]);
      const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
      return Object.freeze({
        privateKey,
        publicKeySpki: createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64'),
        created: false,
      });
    } catch {
      // Fichier présent mais illisible avec CETTE clé : on ne le remplace pas en silence,
      // sinon tous les téléphones appairés cesseraient de reconnaître le PC sans explication.
      throw new Error('pc_chat_identity_illisible');
    }
  }
  if (existing) throw new Error('pc_chat_identity_version_inconnue');

  const pair = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    publicKeyEncoding: { type: 'spki', format: 'der' },
  });
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(Buffer.from(IDENTITY_INFO, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(pair.privateKey), cipher.final()]);
  await writeFile(filePath, `${JSON.stringify({
    version: SCHEMA_VERSION,
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    // La clé publique est en clair : elle n'est pas un secret, et la lire évite un
    // déverrouillage pour un simple affichage.
    publicKeySpki: pair.publicKey.toString('base64'),
  }, null, 2)}\n`);

  return Object.freeze({
    privateKey: createPrivateKey({ key: pair.privateKey, format: 'der', type: 'pkcs8' }),
    publicKeySpki: pair.publicKey.toString('base64'),
    created: true,
  });
}

/** Lit la clé PUBLIQUE sans déverrouiller le coffre — pour l'affichage seul. */
export async function readPcChatPublicKey({ filePath, readFile } = {}) {
  const existing = await readFile(filePath, 'utf8').then(JSON.parse).catch(() => null);
  return existing?.publicKeySpki ?? null;
}
