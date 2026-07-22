function inScope(candidate, filters) {
  if (filters.identity && candidate.identity !== filters.identity) return false;
  if (filters.from !== undefined && candidate.date < filters.from) return false;
  if (filters.to !== undefined && candidate.date > filters.to) return false;
  if (filters.classifications && !filters.classifications.includes(candidate.classification)) return false;
  return true;
}

function normalizedScores(candidates) {
  const maximum = Math.max(...candidates.map(({ score }) => score), 0);
  return new Map(candidates.map(({ id, score }) => [id, maximum > 0 ? score / maximum : 0]));
}

export function createRetriever({
  lexicalSearch,
  embedder,
  vectorStore,
  lexicalWeight = 0.55,
  semanticWeight = 0.45,
} = {}) {
  if (typeof lexicalSearch !== 'function') throw new TypeError('lexical_search_required');
  if (lexicalWeight < 0 || semanticWeight < 0 || lexicalWeight + semanticWeight === 0) {
    throw new TypeError('invalid_retriever_weights');
  }

  async function search({ query, filters = {} } = {}) {
    const lexical = (await lexicalSearch(query, filters)).filter((candidate) => inScope(candidate, filters));
    if (lexical.some((candidate) => !candidate.id || !candidate.provenance)) {
      throw new Error('rag_provenance_required');
    }
    const lexicalScores = normalizedScores(lexical);
    let semantic = [];
    let status = 'ok';
    if (!embedder || !vectorStore) {
      status = 'semantic_degraded';
    } else {
      try {
        const queryVector = await embedder.embed(query);
        semantic = vectorStore.rankExact({
          queryVector,
          candidateIds: lexical.map(({ id }) => id),
        });
      } catch (error) {
        if (error?.message !== 'embedding_model_unavailable') throw error;
        status = 'semantic_degraded';
      }
    }
    const semanticScores = new Map(semantic.map(({ id, score }) => [id, Math.max(0, score)]));
    const results = lexical.map((candidate) => ({
      ...candidate,
      lexicalScore: lexicalScores.get(candidate.id) ?? 0,
      semanticScore: semanticScores.get(candidate.id) ?? 0,
      score: lexicalWeight * (lexicalScores.get(candidate.id) ?? 0)
        + (status === 'ok' ? semanticWeight * (semanticScores.get(candidate.id) ?? 0) : 0),
    })).sort((left, right) => right.score - left.score || String(left.id).localeCompare(String(right.id)));
    return Object.freeze({ status, results });
  }

  return Object.freeze({ search });
}
