import { z } from 'zod';

const MODES = ['auto', 'local-first', 'local-only'];
const modeSchema = z.enum(MODES, { error: 'Configuration invalide: MINA_INFERENCE_MODE' });
const SMS_ROUTER_MODES = ['native-first', 'httpsms-first', 'native-only', 'httpsms-only'];
const smsModeSchema = z.enum(SMS_ROUTER_MODES, { error: 'Configuration invalide: HTTPSMS_SMS_MODE' });
const SMS_SEND_MODES = ['confirm_every_send', 'auto_allowlisted', 'draft_only'];
const smsSendModeSchema = z.enum(SMS_SEND_MODES, { error: 'Configuration invalide: SMS_SEND_MODE' });

function optionalHour(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) throw new Error(`Configuration invalide: ${name}`);
  return parsed;
}

function csvList(value) {
  return [...new Set(String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean))];
}

function booleanValue(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  if (String(value).toLocaleLowerCase('en-US') === 'true') return true;
  if (String(value).toLocaleLowerCase('en-US') === 'false') return false;
  throw new Error(`Configuration invalide: ${name}`);
}

function configured(value) {
  return Boolean(String(value ?? '').trim());
}

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Configuration invalide: ${name}`);
  return parsed;
}

function loopbackUrl(value) {
  const baseUrl = value?.trim() || 'http://127.0.0.1:1234/v1';
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('Configuration invalide: LM_STUDIO_BASE_URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('LM_STUDIO_BASE_URL doit utiliser HTTP');
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error('LM_STUDIO_BASE_URL doit utiliser le loopback local');
  }
  return baseUrl;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function parseConfig(env = {}) {
  const mode = modeSchema.parse(env.MINA_INFERENCE_MODE?.trim() || 'auto');
  const lmStudioEnabled = booleanValue(env.LM_STUDIO_ENABLED, true, 'LM_STUDIO_ENABLED');
  return deepFreeze({
    inference: {
      mode,
      offline: booleanValue(env.MINA_OFFLINE, false, 'MINA_OFFLINE'),
    },
    providers: {
      gemini: {
        enabled: configured(env.GEMINI_API_KEY),
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash',
      },
      deepseek: {
        enabled: configured(env.DEEPSEEK_API_KEY),
        baseUrl: env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com',
        model: env.DEEPSEEK_MODEL?.trim() || 'deepseek-v4-flash',
      },
      openrouter: {
        enabled: configured(env.OPENROUTER_API_KEY),
        baseUrl: env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1',
        model: env.OPENROUTER_VISION_MODEL?.trim() || null,
      },
      modal: {
        enabled: configured(env.MODAL_PROXY_TOKEN_ID ?? env.MODAL_TOKEN_ID ?? env.MODAL_TOKEN)
          && configured(env.MODAL_PROXY_TOKEN_SECRET ?? env.MODAL_TOKEN_SECRET),
        baseUrl: env.MODAL_ENDPOINT?.trim() || null,
        model: env.MODAL_MODEL?.trim() || null,
      },
      huggingface: {
        enabled: configured(env.HF_TOKEN ?? env.HUGGINGFACE_TOKEN),
        baseUrl: env.HF_INFERENCE_BASE_URL?.trim() || 'https://router.huggingface.co',
        model: env.HF_TEXT_MODEL?.trim() || null,
      },
      youtube: {
        enabled: configured(env.YOUTUBE_API_KEY),
        baseUrl: 'https://www.googleapis.com',
        model: null,
      },
      lmStudio: {
        enabled: lmStudioEnabled,
        baseUrl: loopbackUrl(env.LM_STUDIO_BASE_URL),
        model: env.LM_STUDIO_TEXT_MODEL?.trim() || 'google/gemma-4-e2b',
        visionModel: env.LM_STUDIO_VISION_MODEL?.trim() || env.LM_STUDIO_TEXT_MODEL?.trim() || 'google/gemma-4-e2b',
        embeddingModel: env.LM_STUDIO_EMBEDDING_MODEL?.trim() || 'text-embedding-nomic-embed-text-v1.5',
        timeoutMs: positiveInteger(env.LM_STUDIO_TIMEOUT_MS, 240_000, 'LM_STUDIO_TIMEOUT_MS'),
      },
    },
    telegram: {
      // Numeric Telegram chat id of the owner (Nasro) — obtained via @userinfobot, entered once in
      // the Android app's provisioning screen. Node needs its own copy to gate /home and /mail
      // slash commands: only this identity may ever trigger a deterministic Telegram action.
      ownerChatId: env.TELEGRAM_OWNER_CHAT_ID?.trim() || null,
    },
    sms: {
      // Protocol adapter, never the AGPL httpsms-main service itself — see src/messaging/httpsms/.
      // Never exposes the API key or webhook secret, only whether they are configured.
      httpsms: {
        enabled: configured(env.HTTPSMS_BASE_URL) && configured(env.HTTPSMS_API_KEY)
          && configured(env.HTTPSMS_WEBHOOK_SECRET) && configured(env.HTTPSMS_FROM_NUMBER),
        baseUrl: env.HTTPSMS_BASE_URL?.trim() || null,
        fromNumber: env.HTTPSMS_FROM_NUMBER?.trim() || null,
        mode: smsModeSchema.parse(env.HTTPSMS_SMS_MODE?.trim() || 'native-first'),
        // Local port the inbound-SMS webhook server binds to (loopback only). httpSMS is pointed
        // at http://127.0.0.1:<port>/webhooks/httpsms via a tunnel/reverse-proxy Nasro controls.
        webhookPort: positiveInteger(env.HTTPSMS_WEBHOOK_PORT, 8787, 'HTTPSMS_WEBHOOK_PORT'),
      },
      // Confirm/auto/draft_only decision policy — see src/messaging/sms-send-policy.mjs. Kept
      // separate from `httpsms.mode` (provider routing) on purpose: which transport sends the SMS
      // and whether it's allowed to send WITHOUT a confirmation are two independent decisions.
      policy: {
        sendMode: smsSendModeSchema.parse(env.SMS_SEND_MODE?.trim() || 'confirm_every_send'),
        allowlist: csvList(env.SMS_ALLOWLIST),
        quietHoursStart: optionalHour(env.SMS_QUIET_HOURS_START, 'SMS_QUIET_HOURS_START'),
        quietHoursEnd: optionalHour(env.SMS_QUIET_HOURS_END, 'SMS_QUIET_HOURS_END'),
        maxPerMinute: positiveInteger(env.SMS_MAX_PER_MINUTE, 3, 'SMS_MAX_PER_MINUTE'),
        maxPerDay: positiveInteger(env.SMS_MAX_PER_DAY, 20, 'SMS_MAX_PER_DAY'),
      },
    },
  });
}

export const INFERENCE_MODES = Object.freeze([...MODES]);
