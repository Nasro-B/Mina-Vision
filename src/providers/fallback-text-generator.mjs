const MODES = new Set(['auto', 'local-first', 'local-only']);
const RATE_LIMIT = /(?:\b429\b|rate.?limit|quota|resource_exhausted)/iu;
const TRANSIENT_FAILURE = /(?:timeout|timed.?out|econnreset|econnrefused|text_empty|empty_output|status code \(no body\))/iu;

const isRateLimited = (error) => error?.status === 429 || error?.code === 429
  || RATE_LIMIT.test(String(error?.message ?? error));

const MIN_COOLDOWN_MS = 1_000;
const MAX_COOLDOWN_MS = 3_600_000;

// A provider's own Retry-After (seconds, per HTTP spec) overrides the default cooldown when
// present — bounded so a misbehaving or malicious upstream can't force an hours-long outage.
function retryAfterMs(error) {
  const raw = typeof error?.headers?.get === 'function' ? error.headers.get('retry-after') : undefined;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(Math.max(seconds * 1_000, MIN_COOLDOWN_MS), MAX_COOLDOWN_MS);
}

const isTransientFailure = (error) => (Number.isInteger(error?.status) && error.status >= 500 && error.status <= 599)
  || TRANSIENT_FAILURE.test(String(error?.code ?? '')) || TRANSIENT_FAILURE.test(String(error?.message ?? error));

export function createFallbackTextGenerator({
  providers = [], mode = 'auto', offline = false, onFailure = () => {},
  now = Date.now, rateLimitCooldownMs = 300_000, transientCooldownMs = 60_000,
} = {}) {
  if (!MODES.has(mode) || !Array.isArray(providers)
    || providers.some((provider) => !provider?.id || !['cloud', 'local'].includes(provider.locality)
      || typeof provider.generate !== 'function') || typeof now !== 'function'
    || !Number.isInteger(rateLimitCooldownMs) || rateLimitCooldownMs < 1_000 || rateLimitCooldownMs > 3_600_000
    || !Number.isInteger(transientCooldownMs) || transientCooldownMs < 1_000 || transientCooldownMs > 3_600_000) {
    throw new TypeError('text_fallback_configuration_invalid');
  }

  const local = providers.filter((provider) => provider.locality === 'local');
  const cloud = providers.filter((provider) => provider.locality === 'cloud');
  const routes = offline || mode === 'local-only' ? local : mode === 'local-first' ? [...local, ...cloud] : [...cloud, ...local];
  const unavailableUntil = new Map();

  async function generate(input) {
    const failures = [];
    const forwardDelta = typeof input?.onDelta === 'function' ? input.onDelta : null;
    for (const provider of routes) {
      if ((unavailableUntil.get(provider.id) ?? 0) > now()) {
        failures.push(`${provider.id}:cooldown`);
        continue;
      }
      let observedDelta = false;
      let deltaError = null;
      const providerInput = forwardDelta
        ? {
          ...input,
          onDelta: async (delta) => {
            // Ce marqueur est volontairement avant le premier await : même un fournisseur qui
            // n'attend pas son callback ne pourra pas déclencher un fallback concurrent.
            observedDelta = true;
            try {
              await forwardDelta(delta);
            } catch (error) {
              deltaError = error;
              throw error;
            }
          },
        }
        : input;
      try {
        const result = await provider.generate(providerInput);
        if (!String(result?.output ?? '').trim()) throw new Error('empty_output');
        return result;
      } catch (error) {
        if (deltaError) throw deltaError;
        failures.push(provider.id);
        if (isRateLimited(error)) unavailableUntil.set(provider.id, now() + (retryAfterMs(error) ?? rateLimitCooldownMs));
        else if (isTransientFailure(error)) unavailableUntil.set(provider.id, now() + transientCooldownMs);
        onFailure({ providerId: provider.id, error });
        // Reprendre chez un autre fournisseur après un fragment mélangerait deux réponses dans le
        // même stream durable. Le transport termine donc le flux en échec et le message sera
        // rejoué proprement avec le même eventId.
        if (observedDelta) throw error;
      }
    }
    throw new Error(`text_providers_failed:${failures.join(',') || 'none'}`);
  }

  return Object.freeze({ generate, routes: Object.freeze(routes.map(({ id }) => id)) });
}
