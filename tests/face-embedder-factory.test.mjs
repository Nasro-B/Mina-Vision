import { describe, expect, it } from 'vitest';
import { loadFaceEmbedder } from '../src/biometrics/face-embedder-factory.mjs';

describe('face embedder factory', () => {
  it('reports a missing manifest as unavailable without constructing a recognizer', async () => {
    const result = await loadFaceEmbedder('');

    expect(result).toMatchObject({
      state: 'unavailable',
      reason: 'modele_non_provisionne',
    });
    await expect(result.embedder.embed()).rejects.toThrow('face_model_non_provisionne');
  });
});
