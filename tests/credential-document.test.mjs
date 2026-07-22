import { describe, expect, it } from 'vitest';
import { classifyCredentialDocument } from '../src/security/credential-document.mjs';

// Les faux secrets des fixtures n'ont AUCUN format de clé utilisable.
describe('classifyCredentialDocument (Task 4 / R-03)', () => {
  it('détecte un client OAuth par son chemin ET par son contenu', () => {
    expect(classifyCredentialDocument({
      path: 'C:\\tmp\\client_secret_123.apps.googleusercontent.com.json',
      bytes: Buffer.from(JSON.stringify({ installed: { client_secret: 'redacted-fixture' } })),
    })).toMatchObject({ sensitive: true, reason: 'oauth_client_secret' });

    expect(classifyCredentialDocument({
      path: 'C:\\tmp\\innocent.json',
      bytes: Buffer.from(JSON.stringify({ installed: { client_secret: 'redacted-fixture' } })),
    })).toMatchObject({ sensitive: true, reason: 'oauth_client_secret' });
  });

  it('détecte un compte de service et une clé privée, même renommés', () => {
    expect(classifyCredentialDocument({
      path: 'C:\\tmp\\account.json',
      bytes: Buffer.from(JSON.stringify({ type: 'service_account', private_key: 'fixture' })),
    })).toMatchObject({ sensitive: true, reason: 'service_account' });

    expect(classifyCredentialDocument({
      path: 'C:\\tmp\\notes.txt',
      bytes: Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nfixture\n-----END RSA PRIVATE KEY-----'),
    })).toMatchObject({ sensitive: true, reason: 'private_key' });

    expect(classifyCredentialDocument({ path: 'C:\\certs\\site.pem' }))
      .toMatchObject({ sensitive: true, reason: 'private_key' });
  });

  it('détecte refresh tokens, caches de tokens et bases navigateur par chemin', () => {
    expect(classifyCredentialDocument({
      path: 'C:\\tmp\\data.json',
      bytes: Buffer.from(JSON.stringify({ refresh_token: 'fixture' })),
    })).toMatchObject({ sensitive: true, reason: 'refresh_token' });

    expect(classifyCredentialDocument({ path: 'C:\\app\\token-cache.json' }).sensitive).toBe(true);
    expect(classifyCredentialDocument({ path: 'C:\\Users\\x\\Chrome\\Login Data' }).sensitive).toBe(true);
    expect(classifyCredentialDocument({ path: 'C:\\Users\\x\\.aws\\credentials' }).sensitive).toBe(true);
  });

  it('laisse passer les documents ordinaires, y compris binaires', () => {
    expect(classifyCredentialDocument({
      path: 'C:\\docs\\rapport.md',
      bytes: Buffer.from('# Rapport mensuel\nRien de secret ici.'),
    })).toEqual({ sensitive: false, reason: null });

    expect(classifyCredentialDocument({
      path: 'C:\\docs\\image-notes.txt',
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
    }).sensitive).toBe(false);
  });
});
