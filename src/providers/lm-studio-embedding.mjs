function validateInputs(inputs) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 128
    || inputs.some((input) => typeof input !== 'string' || !input.trim() || input.length > 20_000)) {
    throw new TypeError('local_embedding_input_invalid');
  }
  return inputs.map((input) => input.trim());
}

function validateVector(vector) {
  if (!Array.isArray(vector) || vector.length < 1 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error('local_embedding_vector_invalid');
  }
  return Float32Array.from(vector);
}

export function createLmStudioEmbeddingProvider({
  baseURL = 'http://127.0.0.1:1234/v1',
  model,
  fetchImpl = fetch,
  timeoutMs = 180_000,
} = {}) {
  if (!model) throw new TypeError('lm_studio_embedding_model_required');
  const root = baseURL.replace(/\/$/u, '');
  let lastHealth = Object.freeze({ available: false, reason: 'not_probed' });

  async function request(url, options = {}) {
    try {
      return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error('local_embedding_timeout');
      throw new Error('local_embedding_runtime_unavailable');
    }
  }

  async function probe() {
    try {
      const response = await request(`${root}/models`);
      if (!response.ok) throw new Error(`http_${response.status}`);
      const body = await response.json();
      const models = (body.data ?? []).map(({ id }) => id).filter(Boolean);
      if (!models.includes(model)) throw new Error(`local_embedding_model_unavailable:${model}`);
      lastHealth = Object.freeze({ available: true, models: Object.freeze(models) });
    } catch (error) {
      lastHealth = Object.freeze({ available: false, reason: error.message });
    }
    return lastHealth;
  }

  async function embedMany(input) {
    const inputs = validateInputs(input);
    const state = await probe();
    if (!state.available) throw new Error(state.reason);
    const response = await request(`${root}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: inputs }),
    });
    if (!response.ok) throw new Error(`lm_studio_embedding_http_${response.status}`);
    const body = await response.json();
    const ordered = [...(body.data ?? [])].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
    if (ordered.length !== inputs.length) throw new Error('local_embedding_vector_count_invalid');
    return Object.freeze(ordered.map(({ embedding }) => validateVector(embedding)));
  }

  async function embed(text) {
    return (await embedMany([text]))[0];
  }

  return Object.freeze({
    id: 'lm-studio-embedding',
    locality: 'local',
    network: 'loopback',
    modelId: model,
    capabilities: Object.freeze(['embedding.generate']),
    probe,
    health: () => lastHealth,
    embed,
    embedMany,
  });
}
