import { performance } from 'node:perf_hooks';
import { rankVectorsExact } from '../src/rag/vector-store.mjs';

const VECTOR_COUNT = 100_000;
const DIMENSIONS = 32;
// 2 warmups + 40 mesures. Avec l'ancien échantillon (10 mesures), `ceil(10 × 0,95) - 1 = 9`
// désignait le DERNIER élément : le « p95 » publié était mathématiquement toujours égal au
// maximum (finding F-11 de l'audit 2026-07-27, reproduit : p95Ms = maxMs = 231,84 ms).
const WARMUP_RUNS = 2;
const MEASURED_RUNS = 40;
const RUNS = WARMUP_RUNS + MEASURED_RUNS;
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
const measured = durations.slice(WARMUP_RUNS).sort((a, b) => a - b);

// Percentile par interpolation linéaire (méthode « R-7 », celle de NumPy/Excel) : la valeur
// tombe ENTRE deux mesures au lieu d'être forcée sur un index entier — c'est ce qui empêche le
// p95 de dégénérer en maximum sur un petit échantillon.
function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = fraction * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

const p95 = percentile(measured, 0.95);
const max = measured.at(-1);
process.stdout.write(`${JSON.stringify({
  vectors: VECTOR_COUNT,
  dimensions: DIMENSIONS,
  topK: 100,
  measuredRuns: measured.length,
  p95Ms: Number(p95.toFixed(2)),
  minMs: Number(measured[0].toFixed(2)),
  maxMs: Number(max.toFixed(2)),
  // Honnêteté du chiffre : si le p95 coïncide avec le maximum, l'échantillon ne permet pas de
  // les distinguer — le dire plutôt que laisser croire à deux mesures indépendantes.
  p95DistinctFromMax: p95 < max,
})}\n`);
