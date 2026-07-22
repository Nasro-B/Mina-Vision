import { randomUUID } from 'node:crypto';

export function createConsolidator({ summarize, idGenerator = randomUUID, now = Date.now } = {}) {
  if (typeof summarize !== 'function') throw new TypeError('memory_summarizer_required');

  async function consolidate(events) {
    if (!Array.isArray(events) || events.length === 0 || events.some((event) => !event?.id)) {
      throw new TypeError('memory_sources_required');
    }
    const immutableSources = structuredClone(events);
    const summary = await summarize(immutableSources);
    if (typeof summary !== 'string' || !summary.trim()) throw new Error('invalid_memory_summary');
    return Object.freeze({
      id: idGenerator(),
      version: 1,
      type: 'memory_summary',
      sourceEventIds: immutableSources.map(({ id }) => id),
      summary,
      createdAt: now(),
    });
  }

  return Object.freeze({ consolidate });
}
