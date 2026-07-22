const FILTER_COLUMNS = Object.freeze({
  provider: 'provider_id',
  model: 'model_id',
  capability: 'capability',
  channel: 'channel',
  locality: 'locality',
  status: 'status',
});

function percentile(sorted, value) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * value;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function queryParts({ from, to, filters = {} } = {}) {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) throw new TypeError('analytics_period_invalid');
  const clauses = ['started_at >= @fromMs', 'started_at <= @toMs'];
  const parameters = { fromMs, toMs };
  for (const [key, column] of Object.entries(FILTER_COLUMNS)) {
    if (filters[key] === undefined || filters[key] === null) continue;
    if (typeof filters[key] !== 'string' || filters[key].length === 0 || filters[key].length > 300) {
      throw new TypeError(`analytics_filter_invalid:${key}`);
    }
    clauses.push(`${column} = @${key}`);
    parameters[key] = filters[key];
  }
  return { where: clauses.join(' AND '), parameters };
}

function item(row) {
  return Object.freeze({
    attemptId: row.attempt_id,
    sessionId: row.session_id,
    correlationId: row.correlation_id,
    providerId: row.provider_id,
    modelId: row.model_id,
    capability: row.capability,
    channel: row.channel,
    startedAt: new Date(row.started_at).toISOString(),
    endedAt: new Date(row.ended_at).toISOString(),
    latencyMs: row.latency_ms,
    status: row.status,
    locality: row.locality,
    completeness: row.completeness,
    costMicros: row.cost_micros,
    currency: row.currency,
    costKind: row.cost_kind,
    errorCategory: row.error_category,
  });
}

export function createAnalyticsQuery({ db } = {}) {
  if (!db?.prepare) throw new TypeError('analytics_database_required');

  function query(input = {}) {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 50;
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) {
      throw new TypeError('analytics_pagination_invalid');
    }
    const { where, parameters } = queryParts(input);
    const all = db.prepare(`SELECT * FROM usage_attempts WHERE ${where} ORDER BY started_at DESC, attempt_id DESC`).all(parameters);
    const start = (page - 1) * pageSize;
    const rows = all.slice(start, start + pageSize);
    const latencies = all.map((row) => row.latency_ms).sort((a, b) => a - b);
    const successCount = all.filter((row) => row.status === 'success').length;
    const correlations = new Map();
    for (const row of all) {
      if (!row.correlation_id) continue;
      correlations.set(row.correlation_id, (correlations.get(row.correlation_id) ?? 0) + 1);
    }
    const fallbackCorrelations = [...correlations.values()].filter((count) => count > 1).length;
    const knownCosts = all.filter((row) => row.cost_micros !== null).map((row) => row.cost_micros);
    const sum = (key) => all.reduce((total, row) => total + (row[key] ?? 0), 0);
    const daily = new Map();
    for (const row of all) {
      const date = new Date(row.started_at).toISOString().slice(0, 10);
      const value = daily.get(date) ?? { attempts: 0, costMicros: 0, inputTokens: 0, outputTokens: 0 };
      value.attempts += 1;
      value.costMicros += row.cost_micros ?? 0;
      value.inputTokens += row.input_tokens ?? 0;
      value.outputTokens += row.output_tokens ?? 0;
      daily.set(date, value);
    }
    const aggregates = Object.freeze({
      attempts: all.length,
      successCount,
      successRate: all.length ? successCount / all.length : null,
      correlations: correlations.size,
      fallbackCorrelations,
      fallbackRate: correlations.size ? fallbackCorrelations / correlations.size : null,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      budgetConsumptionMicros: knownCosts.reduce((total, value) => total + value, 0),
      unknownCostAttempts: all.length - knownCosts.length,
      inputTokens: sum('input_tokens'),
      cachedInputTokens: sum('cached_input_tokens'),
      outputTokens: sum('output_tokens'),
      reasoningTokens: sum('reasoning_tokens'),
      inputImages: sum('input_images'),
      inputAudioSeconds: sum('input_audio_seconds'),
      outputAudioSeconds: sum('output_audio_seconds'),
      localComputeMs: sum('local_compute_ms'),
    });
    return Object.freeze({
      items: Object.freeze(rows.map(item)),
      total: all.length,
      page,
      pageSize,
      aggregates,
      series: Object.freeze({
        attemptsByDay: Object.freeze([...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => Object.freeze({ date, value: value.attempts }))),
        costMicrosByDay: Object.freeze([...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => Object.freeze({ date, value: value.costMicros }))),
        tokensByDay: Object.freeze([...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => Object.freeze({
          date, inputTokens: value.inputTokens, outputTokens: value.outputTokens,
        }))),
      }),
    });
  }

  return Object.freeze({ query });
}
