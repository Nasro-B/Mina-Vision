import { describe, expect, it } from 'vitest';
import { deriveGoogleAccountId, resolveGoogleAccountId } from '../src/mail/oauth/google-account-id.mjs';

const ACCOUNT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;

describe('resolveGoogleAccountId (multi-comptes)', () => {
  it('premier compte → google-primary (back-compat)', () => {
    expect(resolveGoogleAccountId({ address: 'owner@gmail.com', existingAccounts: [] })).toBe('google-primary');
  });

  it('reconnexion d’un compte existant → réutilise son id (jamais d’orphelin)', () => {
    const existing = [{ accountId: 'google-primary', provider: 'gmail', address: 'owner@gmail.com' }];
    expect(resolveGoogleAccountId({ address: 'Owner@GMAIL.com', existingAccounts: existing })).toBe('google-primary');
  });

  it('nouveau 2ᵉ compte → id dérivé unique, jamais google-primary', () => {
    const existing = [{ accountId: 'google-primary', provider: 'gmail', address: 'owner@gmail.com' }];
    const id = resolveGoogleAccountId({ address: 'sourire.concept@gmail.com', existingAccounts: existing });
    expect(id).not.toBe('google-primary');
    expect(id).toMatch(ACCOUNT_ID);
    expect(id).toContain('sourire');
  });

  it('collision d’id dérivé → suffixe numérique', () => {
    const existing = [
      { accountId: 'google-primary', provider: 'gmail', address: 'a@gmail.com' },
      { accountId: 'google-contact-gmail-com', provider: 'gmail', address: 'other@x.com' },
    ];
    const id = resolveGoogleAccountId({ address: 'contact@gmail.com', existingAccounts: existing });
    expect(id).toBe('google-contact-gmail-com-2');
  });

  it('deriveGoogleAccountId assainit l’email en id valide', () => {
    expect(deriveGoogleAccountId('Foo.Bar+tag@Gmail.com')).toMatch(ACCOUNT_ID);
    expect(deriveGoogleAccountId('foo@bar.com')).toBe('google-foo-bar-com');
  });
});
