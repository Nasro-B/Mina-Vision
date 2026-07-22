const MAX_PERIOD_MS = 366 * 24 * 60 * 60 * 1_000;
const EXPORT_PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 100_000;
const EXPORT_FIELDS = Object.freeze([
  'attemptId', 'sessionId', 'correlationId', 'providerId', 'modelId', 'capability', 'channel',
  'startedAt', 'endedAt', 'latencyMs', 'status', 'locality', 'completeness', 'costMicros',
  'currency', 'costKind', 'errorCategory',
]);
const FILTERS = new Set(['provider', 'model', 'capability', 'channel', 'locality', 'status']);

function requireObject(value, error) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(error);
  return value;
}

function validateQuery(input) {
  const request = requireObject(input, 'analytics_query_invalid');
  const from = Date.parse(request.from);
  const to = Date.parse(request.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new TypeError('analytics_period_invalid');
  if (to - from > MAX_PERIOD_MS) throw new Error('analytics_period_too_large');
  if (request.page !== undefined && (!Number.isSafeInteger(request.page) || request.page < 1)) {
    throw new TypeError('analytics_pagination_invalid');
  }
  if (request.pageSize !== undefined && (!Number.isSafeInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > 500)) {
    throw new TypeError('analytics_pagination_invalid');
  }
  if (request.filters !== undefined) {
    requireObject(request.filters, 'analytics_filters_invalid');
    for (const [key, value] of Object.entries(request.filters)) {
      if (!FILTERS.has(key) || typeof value !== 'string' || value.length < 1 || value.length > 300) {
        throw new TypeError(`analytics_filter_invalid:${key}`);
      }
    }
  }
  return request;
}

function validateBudgetScope(input) {
  const scope = requireObject(input, 'analytics_budget_scope_invalid');
  if (scope.type === 'daily' && scope.id === undefined) return { type: 'daily' };
  if (['session', 'provider'].includes(scope.type) && typeof scope.id === 'string' && scope.id.length > 0 && scope.id.length <= 300) {
    return { type: scope.type, id: scope.id };
  }
  throw new TypeError('analytics_budget_scope_invalid');
}

function safeRow(row) {
  return Object.fromEntries(EXPORT_FIELDS.map((field) => [field, row?.[field] ?? null]));
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  if (/[",\r\n]/u.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

function serialize(rows, format) {
  const safe = rows.map(safeRow);
  if (format === 'json') return `${JSON.stringify(safe, null, 2)}\n`;
  const header = EXPORT_FIELDS.join(',');
  return `${header}\n${safe.map((row) => EXPORT_FIELDS.map((field) => csvCell(row[field])).join(',')).join('\n')}\n`;
}

export function createAnalyticsController({
  analyticsQuery,
  budgetGuard,
  confirmLocal,
  selectExportPath,
  writer,
} = {}) {
  if (!analyticsQuery?.query || !budgetGuard?.snapshot || typeof confirmLocal !== 'function'
    || typeof selectExportPath !== 'function' || !writer?.writeAtomic) {
    throw new TypeError('analytics_controller_dependencies_required');
  }

  async function query(input) {
    return analyticsQuery.query(validateQuery(input));
  }

  async function budgetSnapshot(input) {
    return budgetGuard.snapshot(validateBudgetScope(input));
  }

  async function exportAnalytics(input) {
    const request = validateQuery(input);
    if (!['csv', 'json'].includes(request.format)) throw new TypeError('analytics_export_format_invalid');
    const confirmed = await confirmLocal({
      reason: 'Exporter les métriques d’utilisation de Mina Vision vers un fichier local.',
      action: { name: 'analytics.export', format: request.format },
    });
    if (!confirmed) throw new Error('analytics_export_refused');
    const path = await selectExportPath({ format: request.format, suggestedName: `mina-vision-usage.${request.format}` });
    if (typeof path !== 'string' || path.length === 0) throw new Error('analytics_export_cancelled');

    const rows = [];
    let page = 1;
    while (rows.length < MAX_EXPORT_ROWS) {
      const result = await analyticsQuery.query({ ...request, page, pageSize: EXPORT_PAGE_SIZE });
      rows.push(...result.items.slice(0, MAX_EXPORT_ROWS - rows.length));
      if (rows.length >= result.total || result.items.length === 0) break;
      page += 1;
    }
    if (rows.length >= MAX_EXPORT_ROWS) throw new Error('analytics_export_too_large');
    const content = serialize(rows, request.format);
    const written = await writer.writeAtomic({ path, content, encoding: 'utf8' });
    return Object.freeze({ exported: true, path, rows: rows.length, bytes: written?.bytes ?? Buffer.byteLength(content) });
  }

  return Object.freeze({ query, budgetSnapshot, export: exportAnalytics });
}
