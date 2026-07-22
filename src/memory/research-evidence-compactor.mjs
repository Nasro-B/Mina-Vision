import { createHash } from 'node:crypto';
import { createConsolidator } from './consolidator.mjs';

const SUMMARY_PREFIX = 'evidence-summary-';

function defaultSummarize(events) {
  const lines = events.map((event) => `- ${String(event.extract ?? '').slice(0, 280)}`);
  return `Synthese de ${events.length} elements de recherche anterieurs :\n${lines.join('\n')}`.slice(0, 6_000);
}

function isSummary(item) {
  return typeof item?.sourceId === 'string' && item.sourceId.startsWith(SUMMARY_PREFIX);
}

// Keeps a research-evidence list bounded at `maxItems` no matter how long a mission runs, by
// folding the oldest raw items into a single running summary instead of silently dropping them
// (the previous `.slice(-N)` behavior). Reuses the existing, previously-unwired consolidator.mjs.
// Each compaction round re-consolidates (prior summary + new overflow) into ONE fresh summary, so
// the summary itself never grows across rounds — list().length stays <= maxItems indefinitely.
export function createResearchEvidenceCompactor({
  maxItems = 50,
  summarize = defaultSummarize,
  idGenerator,
  now = Date.now,
} = {}) {
  if (!Number.isInteger(maxItems) || maxItems < 2) throw new TypeError('invalid_evidence_compactor_max_items');
  const consolidator = createConsolidator({ summarize, idGenerator, now });
  let items = [];

  async function add(newEvidence) {
    if (!Array.isArray(newEvidence)) throw new TypeError('invalid_evidence_batch');
    items = [...items, ...newEvidence];
    if (items.length <= maxItems) return list();

    const existingSummary = items.find(isSummary);
    const raw = items.filter((item) => !isSummary(item));
    const keepCount = maxItems - 1;
    const dropCount = Math.max(raw.length - keepCount, 0);
    const toDrop = raw.slice(0, dropCount);
    const keep = raw.slice(dropCount);

    const toCompact = [
      ...(existingSummary ? [{ id: existingSummary.sourceId, extract: existingSummary.extract }] : []),
      ...toDrop.map((event) => ({ id: event.sourceId, extract: event.extract })),
    ];
    const summary = await consolidator.consolidate(toCompact);
    const digest = createHash('sha256').update(summary.summary).digest('hex');
    const summaryEvidence = Object.freeze({
      sourceId: `${SUMMARY_PREFIX}${summary.id}`,
      locator: 'memory://research/compacted',
      capturedAt: new Date(summary.createdAt).toISOString(),
      contentDigest: `sha256:${digest}`,
      freshnessClass: 'historical',
      extract: summary.summary,
      method: 'model_inference',
      result: { compactedSourceIds: summary.sourceEventIds },
    });

    items = [summaryEvidence, ...keep];
    return list();
  }

  function list() {
    return [...items];
  }

  return Object.freeze({ add, list, count: () => items.length, clear: () => { items = []; } });
}
