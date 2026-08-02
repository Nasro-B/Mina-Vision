import { parseConfig } from './config-schema.mjs';

const EDITABLE_KEYS = new Set([
  'MINA_INFERENCE_MODE', 'MINA_OFFLINE', 'LM_STUDIO_ENABLED', 'LM_STUDIO_BASE_URL',
  'LM_STUDIO_TEXT_MODEL', 'LM_STUDIO_VISION_MODEL', 'LM_STUDIO_VISION_ENABLED', 'LM_STUDIO_EMBEDDING_MODEL', 'LM_STUDIO_TIMEOUT_MS',
  'GEMINI_MODEL', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL',
  'OPENROUTER_BASE_URL', 'OPENROUTER_VISION_MODEL', 'MODAL_ENDPOINT', 'MODAL_MODEL',
  'HF_INFERENCE_BASE_URL', 'HF_TEXT_MODEL',
  'HTTPSMS_BASE_URL', 'HTTPSMS_FROM_NUMBER', 'HTTPSMS_SMS_MODE', 'TELEGRAM_OWNER_CHAT_ID',
  'SMS_SEND_MODE', 'SMS_ALLOWLIST', 'SMS_QUIET_HOURS_START', 'SMS_QUIET_HOURS_END', 'SMS_MAX_PER_MINUTE', 'SMS_MAX_PER_DAY',
]);
const SECRET_ENV = Object.freeze({
  gemini: ['GEMINI_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  modal: ['MODAL_PROXY_TOKEN_ID', 'MODAL_PROXY_TOKEN_SECRET', 'MODAL_TOKEN_ID', 'MODAL_TOKEN', 'MODAL_TOKEN_SECRET'],
  huggingface: ['HF_TOKEN', 'HUGGINGFACE_TOKEN'],
  youtube: ['YOUTUBE_API_KEY'],
});

function freezeSnapshot(config, statuses) {
  const providers = Object.fromEntries(Object.entries(config.providers).map(([id, provider]) => [
    id,
    Object.freeze({ ...provider, enabled: statuses[id] ?? provider.enabled }),
  ]));
  return Object.freeze({
    inference: config.inference,
    providers: Object.freeze(providers),
    sms: config.sms,
    telegram: config.telegram,
  });
}

export function createConfigService({ env = {}, secretStore, envStore } = {}) {
  const values = { ...env };
  const hasStore = Boolean(secretStore?.has);

  async function hasSecret(providerId) {
    if (!Object.hasOwn(SECRET_ENV, providerId)) return false;
    if (hasStore) return Boolean(await secretStore.has(providerId));
    if (providerId === 'modal') {
      return Boolean((values.MODAL_PROXY_TOKEN_ID?.trim() || values.MODAL_TOKEN_ID?.trim() || values.MODAL_TOKEN?.trim())
        && (values.MODAL_PROXY_TOKEN_SECRET?.trim() || values.MODAL_TOKEN_SECRET?.trim()));
    }
    return SECRET_ENV[providerId].some((name) => Boolean(values[name]?.trim()));
  }

  async function snapshot() {
    const config = parseConfig(values);
    const statuses = { lmStudio: config.providers.lmStudio.enabled };
    for (const providerId of Object.keys(SECRET_ENV)) statuses[providerId] = await hasSecret(providerId);
    return freezeSnapshot(config, statuses);
  }

  async function validateProvider(providerId) {
    const state = await snapshot();
    const provider = state.providers[providerId];
    if (!provider) throw new Error(`provider_unknown:${providerId}`);
    if (providerId !== 'lmStudio' && !await hasSecret(providerId)) {
      throw new Error(`provider_secret_missing:${providerId}`);
    }
    if (providerId === 'lmStudio' && !provider.enabled) throw new Error('provider_disabled:lmStudio');
    return Object.freeze({ id: providerId, configured: true, baseUrl: provider.baseUrl, model: provider.model });
  }

  async function updateNonSensitive(patch = {}) {
    for (const [key, value] of Object.entries(patch)) {
      if (!EDITABLE_KEYS.has(key)) throw new Error(`config_key_not_editable:${key}`);
      if (typeof value !== 'string' && typeof value !== 'boolean') throw new TypeError(`config_value_invalid:${key}`);
    }
    const persisted = envStore?.update ? await envStore.update(patch) : null;
    const updates = persisted?.values ?? patch;
    for (const [key, value] of Object.entries(updates)) {
      if (EDITABLE_KEYS.has(key)) values[key] = String(value);
    }
    return snapshot();
  }

  return Object.freeze({ snapshot, validateProvider, updateNonSensitive, hasSecret });
}

export const NON_SENSITIVE_CONFIG_KEYS = Object.freeze([...EDITABLE_KEYS]);
