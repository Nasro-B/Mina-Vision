import { parseConfig } from './config/config-schema.mjs';

const positiveInt = (value, fallback, name) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Configuration invalide: ${name}`);
  }
  return parsed;
};

export function loadConfig(env = process.env, overrides = {}) {
  const scoped = parseConfig(env);
  const config = {
    inference: scoped.inference,
    providers: scoped.providers,
    // Forwarded verbatim: main.mjs reads currentConfig().sms / .telegram at runtime. Omitting them
    // here made those reads throw in the real app while parseConfig-based unit tests stayed green.
    sms: scoped.sms,
    telegram: scoped.telegram,
    geminiApiKey: env.GEMINI_API_KEY?.trim() || null,
    deepseekApiKey: env.DEEPSEEK_API_KEY?.trim() || null,
    openrouterApiKey: env.OPENROUTER_API_KEY?.trim() || null,
    groqApiKey: env.GROQ_API_KEY?.trim() || null,
    deepgramApiKey: env.DEEPGRAM_API_KEY?.trim() || null,
    openrouterVisionModel: env.OPENROUTER_VISION_MODEL?.trim() || null,
    modalEndpoint: env.MODAL_ENDPOINT?.trim() || null,
    modalTokenId: env.MODAL_PROXY_TOKEN_ID?.trim() || env.MODAL_TOKEN_ID?.trim() || env.MODAL_TOKEN?.trim() || null,
    modalTokenSecret: env.MODAL_PROXY_TOKEN_SECRET?.trim() || env.MODAL_TOKEN_SECRET?.trim() || null,
    adbPath: env.ADB_PATH?.trim() || 'adb',
    scrcpyPath: env.SCRCPY_PATH?.trim() || 'scrcpy',
    maxActions: positiveInt(env.MINA_MAX_ACTIONS, 40, 'MINA_MAX_ACTIONS'),
    missionTimeoutMs: positiveInt(env.MINA_TIMEOUT_MS, 900000, 'MINA_TIMEOUT_MS'),
    dryRun: (env.MINA_DRY_RUN ?? 'true').toLowerCase() !== 'false',
    credentialsRotated: (env.MINA_KEYS_ROTATED ?? 'false').toLowerCase() === 'true',
    ...overrides,
  };

  return Object.freeze(config);
}

export function redactConfig(config) {
  return {
    ...config,
    geminiApiKey: config.geminiApiKey ? '[configured]' : '[missing]',
    deepseekApiKey: config.deepseekApiKey ? '[configured]' : '[missing]',
    openrouterApiKey: config.openrouterApiKey ? '[configured]' : '[missing]',
    groqApiKey: config.groqApiKey ? '[configured]' : '[missing]',
    deepgramApiKey: config.deepgramApiKey ? '[configured]' : '[missing]',
    modalTokenId: config.modalTokenId ? '[configured]' : '[missing]',
    modalTokenSecret: config.modalTokenSecret ? '[configured]' : '[missing]',
  };
}
