import { performance } from 'node:perf_hooks';
import { createBlindIndex } from '../src/rag/blind-index.mjs';
import { rankBlindCandidates } from '../src/rag/ranker.mjs';

const DOCUMENT_COUNT = 10_000;
const index = createBlindIndex({ masterKey: Buffer.alloc(32, 97) });
const startedIndex = performance.now();
const documents = Array.from({ length: DOCUMENT_COUNT }, (_, position) => {
  const topic = position % 97 === 0 ? 'recette gâteau chocolat moelleux' : 'mémoire locale mina document général';
  const tokens = index.indexText(`${topic} numéro ${position}`);
  return {
    id: `chunk-${position}`,
    tokens,
    length: tokens.reduce((sum, token) => sum + token.frequency, 0),
  };
});
const indexMs = performance.now() - startedIndex;
const startedSearch = performance.now();
const results = rankBlindCandidates({ queryTokens: index.query('recette gâteau chocolat'), documents });
const searchMs = performance.now() - startedSearch;

process.stdout.write(`${JSON.stringify({
  documents: DOCUMENT_COUNT,
  indexMs: Number(indexMs.toFixed(2)),
  searchMs: Number(searchMs.toFixed(2)),
  matches: results.length,
  first: results[0]?.id ?? null,
})}\n`);
