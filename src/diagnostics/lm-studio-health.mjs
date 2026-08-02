const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function requireLoopbackLmStudioUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('lm_studio_base_url_invalid');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('lm_studio_loopback_required');
  }
  return parsed;
}

function loaded(model) {
  return Array.isArray(model?.loaded_instances) && model.loaded_instances.length > 0;
}

export async function probeLmStudio({ config, fetchImpl = fetch, signal, timeoutMs = 5_000 } = {}) {
  if (!config?.baseUrl || !config.model || !config.visionModel || !config.embeddingModel) {
    throw new TypeError('lm_studio_health_config_required');
  }
  const parsed = requireLoopbackLmStudioUrl(config.baseUrl);
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetchImpl(new URL('/api/v1/models', parsed).href, { signal: requestSignal });
  } catch (error) {
    return Object.freeze({ ready: false, reason: error?.name === 'TimeoutError' ? 'lm_studio_timeout' : 'lm_studio_unreachable' });
  }
  if (!response.ok) return Object.freeze({ ready: false, reason: `lm_studio_http_${response.status}` });
  const body = await response.json();
  const models = Array.isArray(body.models) ? body.models : [];
  const textModel = models.find(({ key }) => key === config.model);
  const visionModel = models.find(({ key }) => key === config.visionModel);
  const embeddingModel = models.find(({ key }) => key === config.embeddingModel);
  const visionEnabled = config.visionEnabled === true;
  const state = {
    text: { model: config.model, loaded: loaded(textModel) && textModel?.type === 'llm' },
    vision: visionEnabled
      ? { model: config.visionModel, enabled: true, loaded: loaded(visionModel) && visionModel?.type === 'llm' && visionModel?.capabilities?.vision === true }
      : { model: config.visionModel, enabled: false, loaded: false, reason: 'lm_studio_vision_disabled' },
    embedding: { model: config.embeddingModel, loaded: loaded(embeddingModel) && embeddingModel?.type === 'embedding' },
  };
  const ready = state.text.loaded && state.embedding.loaded && (!visionEnabled || state.vision.loaded);
  return Object.freeze({
    ready,
    ...(!ready ? { reason: 'lm_studio_models_not_ready' } : {}),
    ...state,
  });
}
