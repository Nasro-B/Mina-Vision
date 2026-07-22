const PROVIDERS = Object.freeze({
  gemini: Object.freeze({ name: 'provider/gemini/api-key', field: 'apiKey' }),
  deepseek: Object.freeze({ name: 'provider/deepseek/api-key', field: 'apiKey' }),
  openrouter: Object.freeze({ name: 'provider/openrouter/api-key', field: 'apiKey' }),
  modal: Object.freeze({ name: 'provider/modal/token', field: 'token' }),
  huggingface: Object.freeze({ name: 'provider/huggingface/token', field: 'token' }),
  youtube: Object.freeze({ name: 'provider/youtube/api-key', field: 'apiKey' }),
  httpsms: Object.freeze({ name: 'provider/httpsms/api-key', field: 'apiKey' }),
  'httpsms-webhook': Object.freeze({ name: 'provider/httpsms/webhook-secret', field: 'secret' }),
});

function provider(providerId) {
  const value = PROVIDERS[providerId];
  if (!value) throw new Error(`provider_secret_unknown:${providerId}`);
  return value;
}

export function createProviderSecretStore({ keyring } = {}) {
  if (!keyring?.setSecret || !keyring?.hasSecret || !keyring?.getSecret || !keyring?.deleteSecret) {
    throw new TypeError('provider_secret_keyring_required');
  }
  return Object.freeze({
    async set(providerId, value) {
      const definition = provider(providerId);
      await keyring.setSecret(definition.name, value);
      return Object.freeze({ providerId, configured: true });
    },
    has(providerId) {
      return keyring.hasSecret(provider(providerId).name);
    },
    async getForProvider(providerId) {
      const definition = provider(providerId);
      const value = await keyring.getSecret(definition.name);
      if (!value) throw new Error(`provider_secret_missing:${providerId}`);
      return Object.freeze({ providerId, [definition.field]: value });
    },
    async revoke(providerId) {
      await keyring.deleteSecret(provider(providerId).name);
      return Object.freeze({ providerId, configured: false });
    },
    async listStatus() {
      return Promise.all(Object.keys(PROVIDERS).map(async (providerId) => Object.freeze({
        providerId,
        configured: await keyring.hasSecret(PROVIDERS[providerId].name),
      })));
    },
  });
}
