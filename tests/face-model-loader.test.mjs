import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFaceModelLoader } from '../src/biometrics/face-model-loader.mjs';

const cleanups = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function fixture({ sha256, inputNames = ['data'], outputNames = ['fc1'] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mina-face-model-'));
  cleanups.push(root);
  const bytes = Buffer.from('synthetic-onnx-fixture');
  await writeFile(join(root, 'model.onnx'), bytes);
  const release = vi.fn(async () => {});
  const runtimeImporter = vi.fn(async () => ({
    InferenceSession: { create: vi.fn(async () => ({ inputNames, outputNames, release })) },
  }));
  const manifest = {
    id: 'face-sface', installPath: root, sha256: sha256 ?? createHash('sha256').update(bytes).digest('hex'),
    modelFile: 'model.onnx', tensorSignature: { inputs: ['data'], outputs: ['fc1'] },
  };
  return { root, release, runtimeImporter, manifest };
}

describe('face model loader', () => {
  it('loads lazily, verifies checksum and unloads the native session', async () => {
    const value = await fixture();
    const loader = createFaceModelLoader({ runtimeImporter: value.runtimeImporter });

    await expect(loader.load(value.manifest)).resolves.toMatchObject({ id: 'face-sface', loaded: true });
    expect(value.runtimeImporter).toHaveBeenCalledTimes(1);
    await expect(loader.unload('face-sface')).resolves.toEqual({ id: 'face-sface', unloaded: true });
    expect(value.release).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing file, checksum mismatch or wrong tensor signature', async () => {
    const value = await fixture();
    const loader = createFaceModelLoader({ runtimeImporter: value.runtimeImporter });
    await expect(loader.load({ ...value.manifest, modelFile: 'missing.onnx' })).rejects.toThrow('face_model_missing');
    await expect(loader.load({ ...value.manifest, sha256: '0'.repeat(64) })).rejects.toThrow('face_model_checksum_mismatch');

    const wrong = await fixture({ outputNames: ['unexpected'] });
    await expect(createFaceModelLoader({ runtimeImporter: wrong.runtimeImporter }).load(wrong.manifest))
      .rejects.toThrow('face_model_tensor_signature_mismatch');
  });
});
