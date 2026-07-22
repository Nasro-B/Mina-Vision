import { describe, expect, it, vi } from 'vitest';
import { createMailAccountStore } from '../src/mail/mail-account-store.mjs';

function fakeKeyring() {
  const secrets = new Map();
  return {
    secrets,
    setSecret: vi.fn(async (name, value) => { secrets.set(name, value); }),
    getSecret: vi.fn(async (name) => (secrets.has(name) ? secrets.get(name) : null)),
    deleteSecret: vi.fn(async (name) => secrets.delete(name)),
  };
}

const RECORD = Object.freeze({
  provider: 'imap-smtp', address: 'nasro@example.test', mode: 3,
  credentials: Object.freeze({ user: 'nasro@example.test', password: 'app-password-secret' }),
  settings: Object.freeze({ imap: { host: 'imap.example.test', port: 993 } }),
});

describe('encrypted per-account mail store', () => {
  it('stores the account under a dedicated keyring domain', async () => {
    const keyring = fakeKeyring();
    const store = createMailAccountStore({ keyring });
    await store.save('personal-imap', RECORD);
    expect(keyring.setSecret).toHaveBeenCalledWith('mail/account/personal-imap', expect.any(String));
  });

  it('returns only a redacted status list, never credentials', async () => {
    const store = createMailAccountStore({ keyring: fakeKeyring() });
    await store.save('personal-imap', RECORD);
    await store.save('work-gmail', { ...RECORD, provider: 'gmail', address: 'nasro@work.test' });

    const statuses = await store.listStatus();
    expect([...statuses].sort((a, b) => a.accountId.localeCompare(b.accountId))).toEqual([
      { accountId: 'personal-imap', provider: 'imap-smtp', address: 'nasro@example.test', mode: 3, configured: true },
      { accountId: 'work-gmail', provider: 'gmail', address: 'nasro@work.test', mode: 3, configured: true },
    ]);
    expect(JSON.stringify(statuses)).not.toContain('app-password-secret');
  });

  it('returns full credentials only through the dedicated internal accessor', async () => {
    const store = createMailAccountStore({ keyring: fakeKeyring() });
    await store.save('personal-imap', RECORD);
    await expect(store.getCredentials('personal-imap')).resolves.toEqual(RECORD.credentials);
  });

  it('returns null credentials for an account that was never configured', async () => {
    const store = createMailAccountStore({ keyring: fakeKeyring() });
    await expect(store.getCredentials('ghost')).resolves.toBeNull();
  });

  it('removes an account from storage and from the status list', async () => {
    const keyring = fakeKeyring();
    const store = createMailAccountStore({ keyring });
    await store.save('personal-imap', RECORD);
    expect(await store.delete('personal-imap')).toBe(true);
    expect(await store.listStatus()).toEqual([]);
    expect(keyring.secrets.has('mail/account/personal-imap')).toBe(false);
  });

  it('rejects an account id outside the safe keyring charset', async () => {
    const store = createMailAccountStore({ keyring: fakeKeyring() });
    await expect(store.save('Personal IMAP', RECORD)).rejects.toThrow('mail_account_id_invalid');
  });
});
