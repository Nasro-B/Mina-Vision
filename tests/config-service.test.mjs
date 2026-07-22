import { describe, expect, it, vi } from 'vitest';
import { createConfigService } from '../src/config/config-service.mjs';

function secrets(values = []) {
  const configured = new Set(values);
  return {
    has: vi.fn(async (id) => configured.has(id)),
  };
}

describe('configuration application service', () => {
  it('returns a redacted snapshot and validates only the requested provider', async () => {
    const service = createConfigService({
      env: { MINA_INFERENCE_MODE: 'local-only', GEMINI_API_KEY: 'legacy-secret' },
      secretStore: secrets(),
    });
    const snapshot = await service.snapshot();

    expect(snapshot.inference.mode).toBe('local-only');
    expect(JSON.stringify(snapshot)).not.toContain('legacy-secret');
    await expect(service.validateProvider('lmStudio')).resolves.toMatchObject({ id: 'lmStudio', configured: true });
    await expect(service.validateProvider('gemini')).rejects.toThrow('provider_secret_missing:gemini');
  });

  it('accepts one configured cloud provider and updates only non-sensitive settings', async () => {
    const service = createConfigService({
      env: {},
      secretStore: secrets(['deepseek']),
    });
    await expect(service.validateProvider('deepseek')).resolves.toMatchObject({ id: 'deepseek', configured: true });
    await expect(service.updateNonSensitive({ MINA_INFERENCE_MODE: 'local-first', DEEPSEEK_MODEL: 'deepseek-v4-pro' }))
      .resolves.toMatchObject({ inference: { mode: 'local-first' }, providers: { deepseek: { model: 'deepseek-v4-pro' } } });
    await expect(service.updateNonSensitive({ DEEPSEEK_API_KEY: 'forbidden' })).rejects.toThrow('config_key_not_editable');
    await expect(service.hasSecret('deepseek')).resolves.toBe(true);
  });

  it('persists editable values through the env document store before exposing them', async () => {
    const envStore = { update: vi.fn(async () => ({ values: { MINA_INFERENCE_MODE: 'local-only', MINA_OFFLINE: 'true' } })) };
    const service = createConfigService({ env: { MINA_INFERENCE_MODE: 'auto' }, envStore });

    await expect(service.updateNonSensitive({ MINA_INFERENCE_MODE: 'local-only', MINA_OFFLINE: true }))
      .resolves.toMatchObject({ inference: { mode: 'local-only', offline: true } });
    expect(envStore.update).toHaveBeenCalledWith({ MINA_INFERENCE_MODE: 'local-only', MINA_OFFLINE: true });
  });

  it('exposes the sms config block in the snapshot — the settings UI reads it', async () => {
    const service = createConfigService({ env: {}, secretStore: secrets() });
    const snapshot = await service.snapshot();
    expect(snapshot.sms).toBeDefined();
    expect(snapshot.sms.httpsms).toMatchObject({ enabled: false, mode: 'native-first' });
    expect(snapshot.sms.policy).toMatchObject({ sendMode: 'confirm_every_send', allowlist: [] });
  });

  it('updates SMS policy settings (mode, allowlist, quiet hours, budgets) as non-sensitive keys', async () => {
    const service = createConfigService({ env: {}, secretStore: secrets() });
    const updated = await service.updateNonSensitive({
      SMS_SEND_MODE: 'auto_allowlisted', SMS_ALLOWLIST: '+33600000002,+33600000003',
      SMS_QUIET_HOURS_START: '8', SMS_QUIET_HOURS_END: '22',
    });
    expect(updated.sms.policy).toMatchObject({
      sendMode: 'auto_allowlisted', allowlist: ['+33600000002', '+33600000003'], quietHoursStart: 8, quietHoursEnd: 22,
    });
  });

  it('exposes the telegram owner chat id config block, null by default', async () => {
    const service = createConfigService({ env: {}, secretStore: secrets() });
    expect((await service.snapshot()).telegram).toEqual({ ownerChatId: null });
    const updated = await service.updateNonSensitive({ TELEGRAM_OWNER_CHAT_ID: '123456789' });
    expect(updated.telegram).toEqual({ ownerChatId: '123456789' });
  });
});
