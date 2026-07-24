import { describe, expect, it, vi } from 'vitest';
import { createFaceEmbedder } from '../src/biometrics/face-embedder.mjs';

const MANIFEST = Object.freeze({
  id: 'arcface-test',
  inputName: 'input',
  outputName: 'embedding',
  preprocess: { inputWidth: 4, inputHeight: 4, mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5], layout: 'nchw' },
});

// sharp factice : renvoie une image 4x4 RGB pleine (48 octets), chaînage fluide.
function fakeSharp() {
  return () => {
    const pipeline = {
      resize: () => pipeline,
      removeAlpha: () => pipeline,
      raw: () => pipeline,
      toBuffer: async () => ({ data: Buffer.alloc(4 * 4 * 3, 128), info: { width: 4, height: 4, channels: 3 } }),
    };
    return pipeline;
  };
}

describe('face embedder (pipeline réel piloté par manifeste)', () => {
  it('décode, normalise en NCHW selon le manifeste, exécute le modèle, renvoie le vecteur', async () => {
    const run = vi.fn(async (id, feeds) => {
      expect(id).toBe('arcface-test');
      expect(feeds.input.dims).toEqual([1, 3, 4, 4]);
      // pixel 128/255 - 0.5 / 0.5 ≈ 0.00392 pour chaque canal
      expect(feeds.input.data[0]).toBeCloseTo((128 / 255 - 0.5) / 0.5, 4);
      return { embedding: { data: Float32Array.from([0.1, 0.2, 0.3, 0.4]) } };
    });
    const embedder = createFaceEmbedder({
      loader: { run },
      manifest: MANIFEST,
      sharpImpl: fakeSharp(),
      createTensor: (type, data, dims) => ({ type, data, dims }),
    });
    const vec = await embedder.embed({ image: Buffer.from('jpeg') });
    expect(vec).toEqual([0.1, 0.2, 0.3, 0.4].map((v) => expect.closeTo(v, 5)));
    expect(run).toHaveBeenCalledOnce();
  });

  it('layout NHWC produit les dimensions [1,H,W,3]', async () => {
    const run = vi.fn(async (_id, feeds) => {
      expect(feeds.input.dims).toEqual([1, 4, 4, 3]);
      return { embedding: { data: Float32Array.from([1]) } };
    });
    const embedder = createFaceEmbedder({
      loader: { run },
      manifest: { ...MANIFEST, preprocess: { ...MANIFEST.preprocess, layout: 'nhwc' } },
      sharpImpl: fakeSharp(),
      createTensor: (type, data, dims) => ({ type, data, dims }),
    });
    await embedder.embed({ image: Buffer.from('x') });
    expect(run).toHaveBeenCalled();
  });

  it('rejette un manifeste invalide (std nul = division impossible)', () => {
    expect(() => createFaceEmbedder({
      loader: { run: vi.fn() }, sharpImpl: fakeSharp(), createTensor: vi.fn(),
      manifest: { ...MANIFEST, preprocess: { ...MANIFEST.preprocess, std: [0, 0.5, 0.5] } },
    })).toThrow('face_embedder_manifest_invalid');
  });

  it('fail-loud si le modèle ne renvoie aucun tenseur de sortie attendu', async () => {
    const embedder = createFaceEmbedder({
      loader: { run: async () => ({}) }, manifest: MANIFEST, sharpImpl: fakeSharp(),
      createTensor: (type, data, dims) => ({ type, data, dims }),
    });
    await expect(embedder.embed({ image: Buffer.from('x') })).rejects.toThrow('face_embedder_no_output');
  });

  it('exige une image', async () => {
    const embedder = createFaceEmbedder({
      loader: { run: vi.fn() }, manifest: MANIFEST, sharpImpl: fakeSharp(), createTensor: vi.fn(),
    });
    await expect(embedder.embed({})).rejects.toThrow('face_embedder_image_required');
  });
});
