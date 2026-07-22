import { describe, expect, it } from 'vitest';
import { loadConfig, redactConfig } from '../src/config.mjs';

describe('loadConfig', () => {
  it('starts without Gemini credentials', () => {
    expect(loadConfig({}).geminiApiKey).toBeNull();
  });

  it('never exposes secret values in diagnostics', () => {
    const config = loadConfig({
      GEMINI_API_KEY: 'gemini-secret',
      OPENROUTER_API_KEY: 'router-secret',
    });

    expect(JSON.stringify(redactConfig(config))).not.toMatch(/gemini-secret|router-secret/);
  });

  it('uses finite safety budgets', () => {
    const config = loadConfig({
      GEMINI_API_KEY: 'x',
      MINA_MAX_ACTIONS: '25',
      MINA_TIMEOUT_MS: '600000',
    });

    expect(config.maxActions).toBe(25);
    expect(config.missionTimeoutMs).toBe(600000);
  });

  it('keeps live providers locked until exposed credentials are rotated', () => {
    expect(loadConfig({ GEMINI_API_KEY: 'x' }).credentialsRotated).toBe(false);
    expect(loadConfig({ GEMINI_API_KEY: 'x', MINA_KEYS_ROTATED: 'true' }).credentialsRotated).toBe(true);
  });

  it('accepts the official Modal proxy credential names as an exact pair', () => {
    const config = loadConfig({
      MODAL_PROXY_TOKEN_ID: 'proxy-id',
      MODAL_PROXY_TOKEN_SECRET: 'proxy-secret',
    });
    expect(config.modalTokenId).toBe('proxy-id');
    expect(config.modalTokenSecret).toBe('proxy-secret');
    expect(config.providers.modal.enabled).toBe(true);
  });
});

describe('loadConfig: scoped blocks reachable by the Electron runtime', () => {
  it('exposes the sms and telegram blocks — main.mjs reads currentConfig().sms / .telegram directly', () => {
    // Regression guard: loadConfig used to copy only inference+providers, so every
    // currentConfig().sms access in main.mjs threw "Cannot destructure property of undefined"
    // at runtime while every unit test (which calls parseConfig) stayed green.
    const config = loadConfig({});
    expect(config.sms).toBeDefined();
    expect(config.sms.httpsms).toMatchObject({ enabled: false, mode: 'native-first' });
    expect(config.sms.policy).toMatchObject({ sendMode: 'confirm_every_send' });
    expect(config.telegram).toEqual({ ownerChatId: null });
  });

  it('carries real sms/telegram values through, not just defaults', () => {
    const config = loadConfig({ HTTPSMS_SMS_MODE: 'httpsms-first', TELEGRAM_OWNER_CHAT_ID: '123456789' });
    expect(config.sms.httpsms.mode).toBe('httpsms-first');
    expect(config.telegram.ownerChatId).toBe('123456789');
  });
});

describe('loadConfig: Groq web-search fallback key', () => {
  it('exposes GROQ_API_KEY and redacts it', async () => {
    const { redactConfig } = await import('../src/config.mjs');
    const config = loadConfig({ GROQ_API_KEY: ' gsk-test ' });
    expect(config.groqApiKey).toBe('gsk-test');
    expect(loadConfig({}).groqApiKey).toBeNull();
    expect(redactConfig(config).groqApiKey).toBe('[configured]');
  });
});
