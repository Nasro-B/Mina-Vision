import { describe, expect, it, vi } from 'vitest';
import { createConfigService, NON_SENSITIVE_CONFIG_KEYS } from '../src/config/config-service.mjs';
import { createSettingsController } from '../src/ui/pages/settings-controller.mjs';

function fakeSecretStore() {
  return { listStatus: vi.fn(async () => []), set: vi.fn(), revoke: vi.fn() };
}

describe('settings UI contract: renderer reads exactly what the controller exposes', () => {
  it('lists every SMS/httpSMS key the renderer needs to render an input for, as editable', () => {
    for (const key of ['HTTPSMS_BASE_URL', 'HTTPSMS_FROM_NUMBER', 'HTTPSMS_SMS_MODE',
      'SMS_SEND_MODE', 'SMS_ALLOWLIST', 'SMS_QUIET_HOURS_START', 'SMS_QUIET_HOURS_END', 'SMS_MAX_PER_MINUTE', 'SMS_MAX_PER_DAY']) {
      expect(NON_SENSITIVE_CONFIG_KEYS).toContain(key);
    }
  });

  it('getState().config.sms is defined and never throws — the renderer indexes into it unconditionally', async () => {
    const configService = createConfigService({ env: {}, secretStore: fakeSecretStore() });
    const controller = createSettingsController({
      configService, secretStore: fakeSecretStore(), providerTester: async () => ({}), providerMetadata: {},
    });

    const state = await controller.getState();

    expect(state.config.sms.httpsms).toMatchObject({ enabled: false, mode: 'native-first', baseUrl: null, fromNumber: null });
    expect(state.config.sms.policy).toMatchObject({ sendMode: 'confirm_every_send', allowlist: [] });
  });

  it('a full round trip: writing SMS settings through the controller and reading them back matches', async () => {
    const configService = createConfigService({ env: {}, secretStore: fakeSecretStore() });
    const controller = createSettingsController({
      configService, secretStore: fakeSecretStore(), providerTester: async () => ({}), providerMetadata: {},
    });

    await controller.update({
      HTTPSMS_BASE_URL: 'https://api.httpsms.test', HTTPSMS_FROM_NUMBER: '+33700000000',
      SMS_SEND_MODE: 'auto_allowlisted', SMS_ALLOWLIST: '+33600000002',
    });
    const state = await controller.getState();

    expect(state.config.sms.httpsms.baseUrl).toBe('https://api.httpsms.test');
    expect(state.config.sms.httpsms.fromNumber).toBe('+33700000000');
    expect(state.config.sms.policy.sendMode).toBe('auto_allowlisted');
    expect(state.config.sms.policy.allowlist).toEqual(['+33600000002']);
  });

  it('never exposes the httpSMS API key or webhook secret through the settings state', async () => {
    const configService = createConfigService({
      env: { HTTPSMS_API_KEY: 'super-secret-key', HTTPSMS_WEBHOOK_SECRET: 'super-secret-whsec' },
      secretStore: fakeSecretStore(),
    });
    const controller = createSettingsController({
      configService, secretStore: fakeSecretStore(), providerTester: async () => ({}), providerMetadata: {},
    });

    const state = await controller.getState();

    expect(JSON.stringify(state)).not.toContain('super-secret-key');
    expect(JSON.stringify(state)).not.toContain('super-secret-whsec');
  });
});
