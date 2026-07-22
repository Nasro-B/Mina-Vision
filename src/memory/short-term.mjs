function defaultEstimateTokens(text) {
  return Math.max(1, Math.ceil(String(text ?? '').length / 4));
}

export function createShortTermMemory({
  maxEvents = 50,
  maxTokens = 8_000,
  estimateTokens = defaultEstimateTokens,
} = {}) {
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || !Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new TypeError('invalid_short_term_limits');
  }
  const entries = [];
  let tokens = 0;

  function add(event) {
    if (!event?.id) throw new TypeError('invalid_short_term_event');
    const tokenCount = estimateTokens(event.content);
    if (!Number.isInteger(tokenCount) || tokenCount < 0) throw new TypeError('invalid_token_estimate');
    entries.push({ event: structuredClone(event), tokenCount });
    tokens += tokenCount;
    while (entries.length > maxEvents || tokens > maxTokens) {
      tokens -= entries.shift().tokenCount;
    }
  }

  function list() {
    return entries.map(({ event }) => structuredClone(event));
  }

  return Object.freeze({ add, list, tokenCount: () => tokens, clear: () => { entries.splice(0); tokens = 0; } });
}
