export function rankBlindCandidates({ queryTokens, documents, k1 = 1.2, b = 0.75 } = {}) {
  if (!Array.isArray(queryTokens) || !Array.isArray(documents)) throw new TypeError('ranker_input_required');
  if (documents.length === 0) return [];
  const query = new Set(queryTokens.map((token) => Buffer.from(token).toString('hex')));
  const documentFrequency = new Map();
  for (const document of documents) {
    const present = new Set(document.tokens.map(({ hash }) => Buffer.from(hash).toString('hex')));
    for (const hash of query) {
      if (present.has(hash)) documentFrequency.set(hash, (documentFrequency.get(hash) ?? 0) + 1);
    }
  }
  const averageLength = documents.reduce((sum, document) => sum + document.length, 0) / documents.length || 1;
  return documents.map((document) => {
    const frequencies = new Map(document.tokens.map(({ hash, frequency }) => [
      Buffer.from(hash).toString('hex'), frequency,
    ]));
    let score = 0;
    for (const hash of query) {
      const frequency = frequencies.get(hash) ?? 0;
      if (frequency === 0) continue;
      const df = documentFrequency.get(hash) ?? 0;
      const inverseDocumentFrequency = Math.log(1 + ((documents.length - df + 0.5) / (df + 0.5)));
      const normalization = frequency + k1 * (1 - b + b * (document.length / averageLength));
      score += inverseDocumentFrequency * ((frequency * (k1 + 1)) / normalization);
    }
    return { id: document.id, score };
  }).filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || String(left.id).localeCompare(String(right.id)));
}
