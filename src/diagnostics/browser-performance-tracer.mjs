import { createBrowserPerformanceSpan } from '../browser/browser-contracts.mjs';

// Traceur de performance de la navigation (SPEC-MINA-BROWSER-001 §5, §8.4, §20, §21). Mesure Mina,
// Playwright, le site et le fournisseur SÉPARÉMENT, par phase et par voie. Expose p50, p95, maximum,
// timeouts et fallbacks. Ne conserve JAMAIS de texte saisi, requête, URL complète, capture, DOM ni
// secret : chaque span passe par createBrowserPerformanceSpan qui ne garde que des nombres, une
// origine et des étiquettes. Ring borné (pas de croissance mémoire). Module PUR, non câblé au runtime.

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function summarize(spans) {
  const durations = spans.map((span) => span.durationMs).sort((a, b) => a - b);
  return Object.freeze({
    count: spans.length,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    max: durations.length ? durations[durations.length - 1] : 0,
    timeouts: spans.filter((span) => span.timeout).length,
    fallbacks: spans.filter((span) => span.fallback).length,
    failures: spans.filter((span) => span.status && span.status !== 'ok').length,
  });
}

export function createBrowserPerformanceTracer({ maxSpans = 2_000, now = () => 0 } = {}) {
  const spans = [];
  return Object.freeze({
    record(input = {}) {
      const span = createBrowserPerformanceSpan({ ...input, recordedAt: Number.isFinite(input.recordedAt) ? input.recordedAt : now() });
      spans.push(span);
      if (spans.length > maxSpans) spans.shift(); // ring borné : jamais de fuite mémoire
      return span;
    },
    size: () => spans.length,
    spans: () => spans.map((span) => ({ ...span })),
    // Résumé filtrable par phase et/ou voie. Sans filtre = tout.
    summary({ phase, route } = {}) {
      return summarize(spans.filter((span) => (!phase || span.phase === phase) && (!route || span.route === route)));
    },
    byPhase() {
      const groups = new Map();
      for (const span of spans) {
        if (!groups.has(span.phase)) groups.set(span.phase, []);
        groups.get(span.phase).push(span);
      }
      return Object.fromEntries([...groups].map(([phase, group]) => [phase, summarize(group)]));
    },
    reset() { spans.length = 0; },
  });
}
