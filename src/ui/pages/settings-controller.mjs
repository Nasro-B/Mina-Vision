import { INFERENCE_MODES } from '../../config/config-schema.mjs';
import { NON_SENSITIVE_CONFIG_KEYS } from '../../config/config-service.mjs';

export function createSettingsController({
  configService,
  secretStore,
  providerTester,
  providerMetadata = {},
  timeoutMs = 5_000,
} = {}) {
  if (!configService?.snapshot || !configService?.updateNonSensitive
    || !secretStore?.listStatus || !secretStore?.set || !secretStore?.revoke
    || typeof providerTester !== 'function') {
    throw new TypeError('settings_controller_dependencies_required');
  }

  function getSchema() {
    return Object.freeze({
      modes: Object.freeze([...INFERENCE_MODES]),
      nonSensitiveKeys: Object.freeze([...NON_SENSITIVE_CONFIG_KEYS]),
      providers: Object.freeze(Object.entries(providerMetadata).map(([id, metadata]) => Object.freeze({
        id, locality: metadata.locality,
      }))),
    });
  }

  async function getState() {
    return Object.freeze({
      config: await configService.snapshot(),
      secrets: Object.freeze(await secretStore.listStatus()),
    });
  }

  async function testProvider({ providerId } = {}) {
    const metadata = providerMetadata[providerId];
    if (!metadata) throw new Error(`provider_unknown:${providerId}`);
    const state = await configService.snapshot();
    if (state.inference.mode === 'local-only' && metadata.locality !== 'local') {
      throw new Error(`provider_forbidden_by_mode:${providerId}`);
    }
    if (state.inference.offline && metadata.network !== 'none') {
      throw new Error(`provider_forbidden_offline:${providerId}`);
    }
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('provider_test_timeout'));
      }, timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([providerTester(providerId, { signal: controller.signal }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    getSchema,
    getState,
    update: (patch) => configService.updateNonSensitive(patch),
    setSecret: ({ providerId, value }) => secretStore.set(providerId, value),
    revokeSecret: ({ providerId }) => secretStore.revoke(providerId),
    testProvider,
  });
}
