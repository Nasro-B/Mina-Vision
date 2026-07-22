import { randomUUID } from 'node:crypto';
import { rankScore } from './memory-ranking.mjs';
import { createShortTermMemory } from './short-term.mjs';

const CLASSIFICATIONS = new Set(['normal', 'sensitive', 'secret', 'otp']);
const MASKED = new Set(['sensitive', 'secret', 'otp']);
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

function terms(text) {
  return String(text ?? '').normalize('NFKC').toLocaleLowerCase('fr-FR').match(/[\p{L}\p{N}]+/gu) ?? [];
}

function relevance(content, query) {
  const haystack = new Set(terms(content));
  const needles = terms(query);
  if (needles.length === 0) return 1;
  return needles.filter((term) => haystack.has(term)).length / needles.length;
}

export function createMemoryService({
  eventRepository,
  identityGraph,
  embedder = null,
  vectorStore = null,
  shortTerm = createShortTermMemory(),
  idGenerator = randomUUID,
  now = Date.now,
  // Optionnel (createSalienceTracker) : pondère le CLASSEMENT par récence + accès répétés.
  // Absent → comportement historique inchangé. Jamais une expiration : plancher dans rankScore.
  salience = null,
} = {}) {
  if (!eventRepository?.write || !eventRepository?.read || !eventRepository?.listByIdentity || !identityGraph?.resolve
    || Boolean(embedder) !== Boolean(vectorStore)) {
    throw new TypeError('memory_service_dependencies_required');
  }

  function publicMemory(event, score, revealSensitive) {
    return {
      content: !revealSensitive && MASKED.has(event.classification) ? '••••' : event.content,
      score,
      provenance: structuredClone(event.provenance),
      date: event.createdAt,
      classification: event.classification,
      retention: event.retention,
    };
  }

  function remember({ eventId, kind, value, channel, content, classification = 'normal', provenance = {} } = {}) {
    const owner = identityGraph.resolve({ kind, value });
    if (!owner) throw new Error('memory_identity_unresolved');
    if (!channel || typeof content !== 'string' || !CLASSIFICATIONS.has(classification)) {
      throw new TypeError('invalid_memory_input');
    }
    if (eventId !== undefined && !EVENT_ID_PATTERN.test(eventId)) {
      throw new TypeError('invalid_memory_event_id');
    }
    const id = eventId ?? idGenerator();
    if (!EVENT_ID_PATTERN.test(id)) throw new TypeError('invalid_memory_event_id');
    const existing = eventRepository.read(id);
    if (existing?.event) return structuredClone(existing.event);
    const event = {
      id,
      version: 1,
      createdAt: now(),
      type: 'memory',
      identity: owner.id,
      channel,
      source: provenance.deviceId ?? provenance.source ?? channel,
      content,
      classification,
      provenance: structuredClone(provenance),
      retention: 'indefinite',
    };
    try {
      eventRepository.write({
        event,
        chunks: [{ id: `${id}:0`, ordinal: 0, content }],
      });
    } catch (error) {
      const concurrent = eventRepository.read(id);
      if (concurrent?.event) return structuredClone(concurrent.event);
      throw error;
    }
    shortTerm.add(event);
    return structuredClone(event);
  }

  // Classement commun aux deux rappels : score de base (lexical ou vectoriel), pondéré par
  // récence/salience quand un tracker est fourni ; les résultats servis nourrissent la salience.
  function ranked(scored, revealSensitive) {
    const at = now();
    const weighted = scored
      .map(({ event, score }) => ({
        event,
        score: salience
          ? rankScore({ base: score, createdAt: event.createdAt, now: at, salience: salience.get(event.id) })
          : score,
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || b.event.createdAt - a.event.createdAt);
    if (salience) for (const { event } of weighted) salience.touch(event.id);
    return weighted.map(({ event, score }) => publicMemory(event, score, revealSensitive));
  }

  function recall({ kind, value, query, revealSensitive = false } = {}) {
    const owner = identityGraph.resolve({ kind, value });
    if (!owner) throw new Error('memory_identity_unresolved');
    return ranked(
      eventRepository.listByIdentity(owner.id).map((event) => ({ event, score: relevance(event.content, query) })),
      revealSensitive,
    );
  }

  async function recallSemantic({ kind, value, query, revealSensitive = false } = {}) {
    if (!embedder || !vectorStore) throw new Error('embedding_model_unavailable');
    const owner = identityGraph.resolve({ kind, value });
    if (!owner) throw new Error('memory_identity_unresolved');
    const events = eventRepository.listByIdentity(owner.id);
    if (!events.length) return [];
    const missing = events.filter((event) => !vectorStore.get(`${event.id}:0`));
    for (let offset = 0; offset < missing.length; offset += 128) {
      const batch = missing.slice(offset, offset + 128);
      const vectors = embedder.embedMany
        ? await embedder.embedMany(batch.map(({ content }) => content))
        : await Promise.all(batch.map(({ content }) => embedder.embed(content)));
      batch.forEach((event, index) => vectorStore.put({ chunkId: `${event.id}:0`, vector: vectors[index] }));
    }
    const queryVector = await embedder.embed(String(query ?? ''));
    const scores = new Map(vectorStore.rankExact({
      queryVector,
      candidateIds: events.map(({ id }) => `${id}:0`),
    }).map(({ id, score }) => [String(id).replace(/:0$/u, ''), Math.max(0, score)]));
    return ranked(
      events.map((event) => ({ event, score: scores.get(event.id) ?? 0 })),
      revealSensitive,
    );
  }

  return Object.freeze({ remember, recall, recallSemantic, shortTerm });
}
