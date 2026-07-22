import { describe, expect, it, vi } from 'vitest';
import { createSettingsController } from '../src/ui/pages/settings-controller.mjs';

function harness({ mode = 'auto', tester = async () => ({ ok: true }) } = {}) {
  const configService = {
    snapshot: vi.fn(async () => ({ inference: { mode, offline: false }, providers: { gemini: { enabled: false }, lmStudio: { enabled: true } } })),
    updateNonSensitive: vi.fn(async (patch) => ({ inference: { mode: patch.MINA_INFERENCE_MODE ?? mode } })),
  };
  const secretStore = {
    listStatus: vi.fn(async () => [{ providerId: 'gemini', configured: false }]),
    set: vi.fn(async (providerId) => ({ providerId, configured: true })),
    revoke: vi.fn(async (providerId) => ({ providerId, configured: false })),
  };
  return {
    configService, secretStore,
    controller: createSettingsController({
      configService, secretStore, providerTester: tester, timeoutMs: 10,
      providerMetadata: { gemini: { locality: 'cloud' }, lmStudio: { locality: 'local' } },
    }),
  };
}

describe('settings controller', () => {
  it('returns schema and redacted state, updates options, sets and revokes secrets', async () => {
    const { controller, configService, secretStore } = harness();
    expect(controller.getSchema()).toMatchObject({ modes: ['auto', 'local-first', 'local-only'] });
    expect(JSON.stringify(await controller.getState())).not.toMatch(/apiKey|secret-value/u);
    await controller.update({ MINA_INFERENCE_MODE: 'local-first' });
    expect(configService.updateNonSensitive).toHaveBeenCalledWith({ MINA_INFERENCE_MODE: 'local-first' });
    await controller.setSecret({ providerId: 'gemini', value: 'secret-value' });
    await controller.revokeSecret({ providerId: 'gemini' });
    expect(secretStore.set).toHaveBeenCalledWith('gemini', 'secret-value');
    expect(secretStore.revoke).toHaveBeenCalledWith('gemini');
  });

  it('enforces local-only and bounds provider tests', async () => {
    const localOnly = harness({ mode: 'local-only' }).controller;
    await expect(localOnly.testProvider({ providerId: 'gemini' })).rejects.toThrow('provider_forbidden_by_mode');
    await expect(localOnly.testProvider({ providerId: 'lmStudio' })).resolves.toEqual({ ok: true });

    const slow = harness({ tester: () => new Promise(() => {}) }).controller;
    await expect(slow.testProvider({ providerId: 'gemini' })).rejects.toThrow('provider_test_timeout');
  });
});
