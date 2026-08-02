import { createSign } from 'node:crypto';

// Minteur LOCAL de custom tokens Firebase : remplace le backend externe (MINA_BACKUP_TOKEN_ENDPOINT)
// par ce que ce backend aurait fait — signer un JWT RS256 avec le compte de service Firebase déjà
// présent sur cette machine (env/*.json, jamais commité). Format officiel des custom tokens
// (Identity Toolkit) : signInWithCustomToken l'accepte tel quel côté client SDK.
//
// La clé privée du compte de service ne quitte jamais ce module ; seul le JWT signé (durée 1 h max,
// bornée par Google) en sort. Le `uid` frappé DOIT égaler l'expectedOwnerId de firebase-backup —
// c'est la garde anti-usurpation du propriétaire.

const IDENTITY_TOOLKIT_AUDIENCE = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

const base64url = (input) => Buffer.from(input).toString('base64url');

export function createCustomTokenMinter({
  serviceAccount,
  uid,
  expectedProjectId = null,
  clock = () => Date.now(),
  ttlSeconds = 3_600,
} = {}) {
  const email = serviceAccount?.client_email;
  const privateKey = serviceAccount?.private_key;
  if (typeof email !== 'string' || !email.includes('@')) throw new TypeError('token_minter_client_email_invalid');
  if (typeof privateKey !== 'string' || !privateKey.includes('BEGIN PRIVATE KEY')) throw new TypeError('token_minter_private_key_invalid');
  if (typeof uid !== 'string' || uid.length < 1 || uid.length > 128) throw new TypeError('token_minter_uid_invalid');
  if (expectedProjectId && serviceAccount?.project_id !== expectedProjectId) throw new Error('token_minter_project_mismatch');
  const boundedTtl = Math.min(Math.max(Number(ttlSeconds) || 3_600, 60), 3_600);

  return async function mintCustomToken() {
    const nowSeconds = Math.floor(Number(clock()) / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({
      iss: email,
      sub: email,
      aud: IDENTITY_TOOLKIT_AUDIENCE,
      uid,
      iat: nowSeconds,
      exp: nowSeconds + boundedTtl,
    }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const signature = signer.sign(privateKey).toString('base64url');
    return `${header}.${payload}.${signature}`;
  };
}
