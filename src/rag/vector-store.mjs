import { createAad, decryptAead, encryptAead } from '../crypto/aead.mjs';

function requireVector(vector) {
  if (!(vector instanceof Float32Array) || vector.length === 0) throw new TypeError('float32_vector_required');
  if ([...vector].some((value) => !Number.isFinite(value))) throw new TypeError('finite_vector_required');
  return vector;
}

function encodeVector(vector) {
  const value = requireVector(vector);
  const bytes = Buffer.allocUnsafe(4 + value.byteLength);
  bytes.writeUInt32LE(value.length, 0);
  Buffer.from(value.buffer, value.byteOffset, value.byteLength).copy(bytes, 4);
  return bytes;
}

function decodeVector(bytes) {
  const value = Buffer.from(bytes);
  if (value.length < 8) throw new Error('invalid_encrypted_vector');
  const dimension = value.readUInt32LE(0);
  if (value.length !== 4 + dimension * Float32Array.BYTES_PER_ELEMENT) throw new Error('invalid_encrypted_vector');
  const copy = value.subarray(4).buffer.slice(value.byteOffset + 4, value.byteOffset + value.length);
  return new Float32Array(copy);
}

export function cosineSimilarity(left, right) {
  if (left.length !== right.length) throw new Error('embedding_dimension_mismatch');
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function compareBest(left, right) {
  if (right.score !== left.score) return right.score - left.score;
  if (left.id === right.id) return 0;
  return String(left.id) < String(right.id) ? -1 : 1;
}

function isWorse(left, right) {
  return compareBest(left, right) > 0;
}

function pushWorstHeap(heap, candidate) {
  heap.push(candidate);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!isWorse(heap[index], heap[parent])) break;
    [heap[index], heap[parent]] = [heap[parent], heap[index]];
    index = parent;
  }
}

function replaceWorstHeap(heap, candidate) {
  heap[0] = candidate;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let worst = index;
    if (left < heap.length && isWorse(heap[left], heap[worst])) worst = left;
    if (right < heap.length && isWorse(heap[right], heap[worst])) worst = right;
    if (worst === index) break;
    [heap[index], heap[worst]] = [heap[worst], heap[index]];
    index = worst;
  }
}

export function rankVectorsExact({ queryVector, candidates, limit = candidates?.length }) {
  requireVector(queryVector);
  if (!Array.isArray(candidates)) throw new TypeError('vector_candidates_required');
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('vector_result_limit_invalid');
  const heap = [];
  for (const { id, vector } of candidates) {
    const candidate = { id, score: cosineSimilarity(queryVector, requireVector(vector)) };
    if (heap.length < limit) pushWorstHeap(heap, candidate);
    else if (compareBest(candidate, heap[0]) < 0) replaceWorstHeap(heap, candidate);
  }
  return heap.sort(compareBest);
}

export function createVectorStore({ db, encryptionKey } = {}) {
  if (!db || Buffer.from(encryptionKey ?? []).length !== 32) {
    throw new TypeError('vector_store_configuration_required');
  }
  const update = db.prepare('UPDATE memory_chunks SET embedding_ciphertext = ? WHERE chunk_id = ?');
  const select = db.prepare('SELECT embedding_ciphertext FROM memory_chunks WHERE chunk_id = ?');

  function put({ chunkId, vector }) {
    if (!chunkId) throw new TypeError('vector_chunk_id_required');
    const envelope = encryptAead({
      key: encryptionKey,
      plaintext: encodeVector(vector),
      aad: createAad({ version: 1, type: 'embedding_vector', id: chunkId }),
    });
    if (update.run(Buffer.from(JSON.stringify(envelope)), chunkId).changes !== 1) {
      throw new Error('vector_chunk_not_found');
    }
  }

  function get(chunkId) {
    const row = select.get(chunkId);
    if (!row?.embedding_ciphertext) return null;
    const plaintext = decryptAead({
      key: encryptionKey,
      envelope: JSON.parse(Buffer.from(row.embedding_ciphertext).toString('utf8')),
      aad: createAad({ version: 1, type: 'embedding_vector', id: chunkId }),
    });
    return decodeVector(plaintext);
  }

  function rankExact({ queryVector, candidateIds }) {
    requireVector(queryVector);
    if (!Array.isArray(candidateIds)) throw new TypeError('vector_candidates_required');
    return rankVectorsExact({
      queryVector,
      candidates: candidateIds.map((id) => ({ id, vector: get(id) })).filter(({ vector }) => vector),
    });
  }

  return Object.freeze({ put, get, rankExact });
}
