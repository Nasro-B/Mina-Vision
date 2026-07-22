import { performance } from 'node:perf_hooks';
import { rankVectorsExact } from '../src/rag/vector-store.mjs';

const VECTOR_COUNT = 100_000;
const DIMENSIONS = 32;
const RUNS = 12;
const queryVector = Float32Array.from({ length: DIMENSIONS }, (_, index) => (index + 1) / DIMENSIONS);
const candidates = Array.from({ length: VECTOR_COUNT }, (_, candidateIndex) => ({
  id: `vector-${candidateIndex}`,
  vector: Float32Array.from({ length: DIMENSIONS }, (_, dimension) => ((candidateIndex + dimension * 17) % 101) / 100),
}));
const durations = [];
for (let run = 0; run < RUNS; run += 1) {
  const started = performance.now();
  rankVectorsExact({ queryVector, candidates, limit: 100 });
  durations.push(performance.now() - started);
}
const measured = durations.slice(2).sort((a, b) => a - b);
const p95Index = Math.min(measured.length - 1, Math.ceil(measured.length * 0.95) - 1);
process.stdout.write(`${JSON.stringify({
  vectors: VECTOR_COUNT,
  dimensions: DIMENSIONS,
  topK: 100,
  measuredRuns: measured.length,
  p95Ms: Number(measured[p95Index].toFixed(2)),
  minMs: Number(measured[0].toFixed(2)),
  maxMs: Number(measured.at(-1).toFixed(2)),
})}\n`);
