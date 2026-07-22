import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config/config-schema.mjs';

describe('provider-scoped configuration schema', () => {
  it('boots an empty environment in auto mode without exposing provider secrets', () => {
    const config = parseConfig({});
    expect(config.inference).toEqual({ mode: 'auto', offline: false });
    expect(config.providers.gemini.enabled).toBe(false);
    expect(JSON.stringify(config)).not.toMatch(/apiKey|tokenSecret/u);
    expect(Object.isFrozen(config.providers)).toBe(true);
    expect(config.providers.lmStudio).toMatchObject({
      enabled: true,
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'google/gemma-4-e2b',
      visionModel: 'google/gemma-4-e2b',
      embeddingModel: 'text-embedding-nomic-embed-text-v1.5',
      timeoutMs: 240_000,
    });
  });

  it('boots local-only with zero cloud keys and rejects invalid modes', () => {
    expect(parseConfig({ MINA_INFERENCE_MODE: 'local-only' })).toMatchObject({
      inference: { mode: 'local-only', offline: false },
      providers: { gemini: { enabled: false }, deepseek: { enabled: false }, lmStudio: { enabled: true } },
    });
    expect(() => parseConfig({ MINA_INFERENCE_MODE: 'cloud-only' })).toThrow('MINA_INFERENCE_MODE');
  });

  it('describes a configured cloud provider without returning its key', () => {
    const config = parseConfig({
      DEEPSEEK_API_KEY: 'secret-value',
      DEEPSEEK_MODEL: 'deepseek-v4-pro',
    });
    expect(config.providers.deepseek).toMatchObject({
      enabled: true,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
    });
    expect(JSON.stringify(config)).not.toContain('secret-value');
  });

  it('rejects a non-loopback LM Studio endpoint', () => {
    expect(() => parseConfig({ LM_STUDIO_BASE_URL: 'http://192.168.1.12:1234/v1' }))
      .toThrow('LM_STUDIO_BASE_URL doit utiliser le loopback local');
    expect(() => parseConfig({ LM_STUDIO_BASE_URL: 'file://localhost/v1' }))
      .toThrow('LM_STUDIO_BASE_URL doit utiliser HTTP');
  });

  it('reports YouTube Data API v3 as configured only when a key exists', () => {
    expect(parseConfig({}).providers.youtube).toMatchObject({ enabled: false, baseUrl: 'https://www.googleapis.com' });
    expect(parseConfig({ YOUTUBE_API_KEY: 'configured' }).providers.youtube.enabled).toBe(true);
  });

  it('reports httpSMS as unconfigured by default and only enabled with a base URL, API key, webhook secret and sender number', () => {
    expect(parseConfig({}).sms.httpsms).toMatchObject({ enabled: false, mode: 'native-first' });

    const configured = parseConfig({
      HTTPSMS_BASE_URL: 'https://api.httpsms.test', HTTPSMS_API_KEY: 'k', HTTPSMS_WEBHOOK_SECRET: 'whsec_test_secret',
      HTTPSMS_FROM_NUMBER: '+33700000000',
    });
    expect(configured.sms.httpsms).toMatchObject({ enabled: true, baseUrl: 'https://api.httpsms.test', fromNumber: '+33700000000', webhookPort: 8787 });
    expect(JSON.stringify(configured)).not.toContain('whsec_test_secret');
    expect(JSON.stringify(configured)).not.toContain('"k"');
  });

  it('parses a custom HTTPSMS webhook port and rejects a non-numeric one', () => {
    expect(parseConfig({ HTTPSMS_WEBHOOK_PORT: '9001' }).sms.httpsms.webhookPort).toBe(9001);
    expect(() => parseConfig({ HTTPSMS_WEBHOOK_PORT: 'abc' })).toThrow('Configuration invalide: HTTPSMS_WEBHOOK_PORT');
  });

  it('stays disabled when the sender number is missing even if the rest is configured', () => {
    expect(parseConfig({
      HTTPSMS_BASE_URL: 'https://api.httpsms.test', HTTPSMS_API_KEY: 'k', HTTPSMS_WEBHOOK_SECRET: 'whsec_test_secret',
    }).sms.httpsms.enabled).toBe(false);
  });

  it('validates HTTPSMS_SMS_MODE against the four supported routing modes', () => {
    expect(parseConfig({ HTTPSMS_SMS_MODE: 'httpsms-first' }).sms.httpsms.mode).toBe('httpsms-first');
    expect(() => parseConfig({ HTTPSMS_SMS_MODE: 'bogus' })).toThrow('Configuration invalide: HTTPSMS_SMS_MODE');
  });

  it('defaults the SMS send policy to an empty allowlist and no quiet hours', () => {
    expect(parseConfig({}).sms.policy).toEqual({
      sendMode: 'confirm_every_send', allowlist: [], quietHoursStart: null, quietHoursEnd: null,
      maxPerMinute: 3, maxPerDay: 20,
    });
  });

  it('parses a comma-separated SMS allowlist and quiet-hours/budget overrides', () => {
    const config = parseConfig({
      SMS_SEND_MODE: 'auto_allowlisted', SMS_ALLOWLIST: '+33600000002, +33600000003 ,+33600000002',
      SMS_QUIET_HOURS_START: '8', SMS_QUIET_HOURS_END: '22', SMS_MAX_PER_MINUTE: '5', SMS_MAX_PER_DAY: '50',
    });
    expect(config.sms.policy).toEqual({
      sendMode: 'auto_allowlisted', allowlist: ['+33600000002', '+33600000003'],
      quietHoursStart: 8, quietHoursEnd: 22, maxPerMinute: 5, maxPerDay: 50,
    });
  });

  it('rejects an invalid SMS_SEND_MODE and out-of-range quiet hours', () => {
    expect(() => parseConfig({ SMS_SEND_MODE: 'bogus' })).toThrow('Configuration invalide: SMS_SEND_MODE');
    expect(() => parseConfig({ SMS_QUIET_HOURS_START: '25' })).toThrow('Configuration invalide: SMS_QUIET_HOURS_START');
  });
});
