const CAPABILITIES = new Set([
  'text.generate', 'code.generate', 'computer.use', 'embedding', 'ocr', 'vision', 'stt', 'tts',
]);
const LOCAL_PROVIDERS = new Set(['lm-studio', 'local', 'transformers-js', 'local-ocr', 'local-stt', 'local-tts']);

function id(value, name) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,100}$/u.test(value)) throw new TypeError(`model_profile_${name}_invalid`);
  return value;
}

function amount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`model_profile_${name}_invalid`);
  return value;
}

function validate(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new TypeError('model_profile_invalid');
  id(profile.id, 'id');
  id(profile.providerId, 'provider');
  id(profile.modelId, 'model');
  if (!Array.isArray(profile.capabilities) || !profile.capabilities.length || new Set(profile.capabilities).size !== profile.capabilities.length) {
    throw new TypeError('model_profile_capabilities_invalid');
  }
  for (const capability of profile.capabilities) {
    if (!CAPABILITIES.has(capability)) throw new Error(`model_profile_capability_invalid:${capability}`);
  }
  if (!profile.limits || typeof profile.limits !== 'object') throw new TypeError('model_profile_limits_invalid');
  for (const key of ['maxTokens', 'maxCostMicros', 'maxDurationMs']) amount(profile.limits[key], key);
  let price = null;
  if (profile.price !== null && profile.price !== undefined) {
    const start = Date.parse(profile.price.validFrom);
    const end = Date.parse(profile.price.validUntil);
    if (profile.price.currency !== 'USD' || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new TypeError('model_profile_price_invalid');
    }
    amount(profile.price.inputMicrosPerMillion, 'input_price');
    amount(profile.price.outputMicrosPerMillion, 'output_price');
    price = Object.freeze({ ...profile.price, validFromMs: start, validUntilMs: end });
  }
  return Object.freeze({
    id: profile.id, providerId: profile.providerId, modelId: profile.modelId,
    capabilities: Object.freeze([...profile.capabilities]),
    price,
    limits: Object.freeze({ ...profile.limits }),
  });
}

function roundedCost(tokens, microsPerMillion) {
  return (BigInt(tokens) * BigInt(microsPerMillion) + 500_000n) / 1_000_000n;
}

export function createModelProfiles({ profiles = [], clock = Date.now } = {}) {
  if (!Array.isArray(profiles)) throw new TypeError('model_profiles_invalid');
  const entries = new Map();
  for (const value of profiles) {
    const profile = validate(value);
    if (entries.has(profile.id)) throw new Error(`model_profile_duplicate:${profile.id}`);
    entries.set(profile.id, profile);
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  function resolve({ providerId, modelId, capability } = {}) {
    return [...entries.values()].find((profile) => profile.providerId === providerId
      && profile.modelId === modelId && profile.capabilities.includes(capability)) ?? null;
  }

  function estimate({ profileId, inputTokens, outputTokens, requestedDurationMs } = {}) {
    const profile = entries.get(profileId);
    if (!profile) throw new Error(`model_profile_unknown:${profileId}`);
    amount(inputTokens, 'input_tokens');
    amount(outputTokens, 'output_tokens');
    amount(requestedDurationMs, 'duration');
    if (inputTokens + outputTokens > profile.limits.maxTokens) throw new Error('model_profile_limit_exceeded:tokens');
    if (requestedDurationMs > profile.limits.maxDurationMs) throw new Error('model_profile_limit_exceeded:duration');
    if (!profile.price) {
      if (LOCAL_PROVIDERS.has(profile.providerId)) {
        return Object.freeze({ costMicros: 0, currency: null, costKind: 'local_compute', blocked: false });
      }
      return Object.freeze({ costMicros: null, currency: null, costKind: 'unknown', blocked: true, reason: 'profile_price_missing' });
    }
    const at = now();
    if (at < profile.price.validFromMs || at >= profile.price.validUntilMs) {
      return Object.freeze({ costMicros: null, currency: profile.price.currency, costKind: 'unknown', blocked: true, reason: 'profile_price_expired' });
    }
    const total = roundedCost(inputTokens, profile.price.inputMicrosPerMillion)
      + roundedCost(outputTokens, profile.price.outputMicrosPerMillion);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('model_profile_cost_overflow');
    const costMicros = Number(total);
    if (costMicros > profile.limits.maxCostMicros) throw new Error('model_profile_limit_exceeded:cost');
    return Object.freeze({ costMicros, currency: profile.price.currency, costKind: 'profile_estimate', blocked: false });
  }

  return Object.freeze({ resolve, estimate, list: () => Object.freeze([...entries.values()]) });
}
