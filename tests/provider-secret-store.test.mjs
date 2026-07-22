import { describe, expect, it, vi } from 'vitest';
import { createProviderSecretStore } from '../src/security/provider-secret-store.mjs';

function fakeKeyring() {
  const values = new Map();
  return {
    setSecret: vi.fn(async (name, value) => values.set(name, value)),
    hasSecret: vi.fn(async (name) => values.has(name)),
    getSecret: vi.fn(async (name) => values.get(name) ?? null),
    deleteSecret: vi.fn(async (name) => values.delete(name)),
  };
}

describe('provider secret store', () => {
  it('uses domain-separated key names and returns provider-shaped credentials', async () => {
    const keyring = fakeKeyring();
    const store = createProviderSecretStore({ keyring });

    await store.set('gemini', 'gemini-secret');
    await store.set('modal', 'modal-secret');
    expect(keyring.setSecret).toHaveBeenNthCalledWith(1, 'provider/gemini/api-key', 'gemini-secret');
    expect(keyring.setSecret).toHaveBeenNthCalledWith(2, 'provider/modal/token', 'modal-secret');
    await expect(store.getForProvider('gemini')).resolves.toEqual({ providerId: 'gemini', apiKey: 'gemini-secret' });
    await expect(store.getForProvider('modal')).resolves.toEqual({ providerId: 'modal', token: 'modal-secret' });
  });

  it('exposes only redacted status and revokes a provider secret', async () => {
    const store = createProviderSecretStore({ keyring: fakeKeyring() });
    await store.set('deepseek', 'deepseek-secret');
    expect(await store.has('deepseek')).toBe(true);
    expect(await store.listStatus()).toContainEqual({ providerId: 'deepseek', configured: true });
    expect(JSON.stringify(store)).not.toContain('deepseek-secret');
    await store.revoke('deepseek');
    expect(await store.has('deepseek')).toBe(false);
    await expect(store.set('unknown', 'x')).rejects.toThrow('provider_secret_unknown');
  });

  it('stores the YouTube API key in the encrypted provider namespace', async () => {
    const keyring = fakeKeyring();
    const store = createProviderSecretStore({ keyring });
    await store.set('youtube', 'youtube-secret');
    await expect(store.getForProvider('youtube')).resolves.toEqual({ providerId: 'youtube', apiKey: 'youtube-secret' });
    expect(await store.listStatus()).toContainEqual({ providerId: 'youtube', configured: true });
  });

  it('stores the httpSMS API key and webhook secret under distinct provider namespace entries', async () => {
    const keyring = fakeKeyring();
    const store = createProviderSecretStore({ keyring });
    await store.set('httpsms', 'httpsms-api-key');
    await store.set('httpsms-webhook', 'whsec_test');
    expect(keyring.setSecret).toHaveBeenCalledWith('provider/httpsms/api-key', 'httpsms-api-key');
    expect(keyring.setSecret).toHaveBeenCalledWith('provider/httpsms/webhook-secret', 'whsec_test');
    await expect(store.getForProvider('httpsms')).resolves.toEqual({ providerId: 'httpsms', apiKey: 'httpsms-api-key' });
    await expect(store.getForProvider('httpsms-webhook')).resolves.toEqual({ providerId: 'httpsms-webhook', secret: 'whsec_test' });
    expect(await store.listStatus()).toContainEqual({ providerId: 'httpsms', configured: true });
  });
});
