import { describe, it, expect } from 'vitest';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { createCustomTokenMinter } from '../src/backup/custom-token-minter.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });

const serviceAccount = { client_email: 'sa@mina-vission.iam.gserviceaccount.com', private_key: pem };
const clock = () => 1_784_800_000_000;

describe('createCustomTokenMinter', () => {
  it('refuse un compte de service ou un uid invalide', () => {
    expect(() => createCustomTokenMinter({ serviceAccount: {}, uid: 'u' })).toThrow('token_minter_client_email_invalid');
    expect(() => createCustomTokenMinter({ serviceAccount: { client_email: 'sa@x.iam', private_key: 'pas une clé' }, uid: 'u' })).toThrow('token_minter_private_key_invalid');
    expect(() => createCustomTokenMinter({ serviceAccount, uid: '' })).toThrow('token_minter_uid_invalid');
  });

  it('refuse un compte de service rattaché à un autre projet Firebase', () => {
    expect(() => createCustomTokenMinter({
      serviceAccount: { ...serviceAccount, project_id: 'mina-vission' },
      uid: 'mina-owner-pc',
      expectedProjectId: 'mina-vision',
    })).toThrow('token_minter_project_mismatch');
  });

  it('frappe un JWT RS256 au format custom token (iss/sub/aud/uid/iat/exp) signé vérifiable', async () => {
    const mint = createCustomTokenMinter({ serviceAccount, uid: 'mina-owner-pc', clock });
    const token = await mint();
    const [header, payload, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims.iss).toBe(serviceAccount.client_email);
    expect(claims.sub).toBe(serviceAccount.client_email);
    expect(claims.aud).toContain('identitytoolkit');
    expect(claims.uid).toBe('mina-owner-pc');
    expect(claims.exp - claims.iat).toBe(3_600);

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('borne le TTL à 1 h maximum (limite Google), 60 s minimum', async () => {
    const long = createCustomTokenMinter({ serviceAccount, uid: 'u', clock, ttlSeconds: 999_999 });
    const short = createCustomTokenMinter({ serviceAccount, uid: 'u', clock, ttlSeconds: 1 });
    const claimsOf = async (mint) => JSON.parse(Buffer.from((await mint()).split('.')[1], 'base64url').toString());
    expect((await claimsOf(long)).exp - (await claimsOf(long)).iat).toBe(3_600);
    expect((await claimsOf(short)).exp - (await claimsOf(short)).iat).toBe(60);
  });
});
