import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const TENSOR_NAME = /^[A-Za-z0-9._/-]{1,160}$/u;

function validateManifest(manifest) {
  if (!ID.test(manifest?.id ?? '') || !path.isAbsolute(manifest?.installPath ?? '')
    || !SHA256.test(manifest?.sha256 ?? '') || typeof manifest?.modelFile !== 'string'
    || path.isAbsolute(manifest.modelFile) || manifest.modelFile.includes('..')
    || !Array.isArray(manifest?.tensorSignature?.inputs) || manifest.tensorSignature.inputs.length < 1
    || !Array.isArray(manifest?.tensorSignature?.outputs) || manifest.tensorSignature.outputs.length < 1
    || [...manifest.tensorSignature.inputs, ...manifest.tensorSignature.outputs].some((name) => !TENSOR_NAME.test(name))) {
    throw new TypeError('face_model_manifest_invalid');
  }
  return manifest;
}

function sameNames(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && [...actual].sort().every((name, index) => name === [...expected].sort()[index]);
}

export function createFaceModelLoader({
  runtimeImporter = () => import('onnxruntime-node'),
  readFileImpl = readFile,
} = {}) {
  const sessions = new Map();

  return Object.freeze({
    load: async (value) => {
      const manifest = validateManifest(value);
      if (sessions.has(manifest.id)) return Object.freeze({ id: manifest.id, loaded: true, reused: true });
      const modelPath = path.resolve(manifest.installPath, manifest.modelFile);
      let bytes;
      try {
        bytes = await readFileImpl(modelPath);
      } catch {
        throw new Error('face_model_missing');
      }
      const digest = createHash('sha256').update(bytes).digest('hex');
      bytes.fill?.(0);
      if (digest !== manifest.sha256) throw new Error('face_model_checksum_mismatch');
      const runtime = await runtimeImporter();
      const session = await runtime.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
      if (!sameNames(session.inputNames, manifest.tensorSignature.inputs)
        || !sameNames(session.outputNames, manifest.tensorSignature.outputs)) {
        await session.release?.();
        throw new Error('face_model_tensor_signature_mismatch');
      }
      sessions.set(manifest.id, session);
      return Object.freeze({ id: manifest.id, loaded: true, reused: false });
    },
    run: async (id, feeds) => {
      const session = sessions.get(id);
      if (!session) throw new Error('face_model_not_loaded');
      return session.run(feeds);
    },
    unload: async (id) => {
      const session = sessions.get(id);
      if (!session) return Object.freeze({ id, unloaded: false });
      sessions.delete(id);
      await session.release?.();
      return Object.freeze({ id, unloaded: true });
    },
    unloadAll: async () => {
      const ids = [...sessions.keys()];
      await Promise.all(ids.map(async (id) => {
        const session = sessions.get(id);
        sessions.delete(id);
        await session?.release?.();
      }));
      return Object.freeze({ unloaded: ids.length });
    },
  });
}
