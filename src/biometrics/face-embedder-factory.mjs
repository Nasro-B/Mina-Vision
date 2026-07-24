import { existsSync, readFileSync } from 'node:fs';
import { createFaceModelLoader } from './face-model-loader.mjs';
import { createFaceEmbedder } from './face-embedder.mjs';

// Fabrique l'embedder facial en chargeant le modèle ONNX + sharp. Vit DANS le domaine biometrics
// pour respecter l'architecture (onnxruntime-node ne s'importe que sous biometrics/) : main.mjs ne
// touche jamais directement le SDK ONNX, il passe par ici. Fail-loud honnête si rien n'est provisionné.

/**
 * @param {string} manifestPath  chemin du manifest.json du modèle facial provisionné
 * @returns {Promise<{ embedder, state:'available'|'unavailable', reason:(string|null) }>}
 */
export async function loadFaceEmbedder(manifestPath) {
  if (!manifestPath || !existsSync(manifestPath)) {
    return Object.freeze({
      embedder: { embed: async () => { throw new Error('face_model_non_provisionne (voir docs/guides/face-model.md)'); } },
      state: 'unavailable',
      reason: 'modele_non_provisionne',
    });
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const loader = createFaceModelLoader();
    await loader.load(manifest);
    const [sharpMod, ortMod] = await Promise.all([import('sharp'), import('onnxruntime-node')]);
    const sharpImpl = sharpMod.default ?? sharpMod;
    const ort = ortMod.default ?? ortMod;
    const embedder = createFaceEmbedder({
      loader,
      manifest,
      sharpImpl,
      createTensor: (type, data, dims) => new ort.Tensor(type, data, dims),
    });
    return Object.freeze({ embedder, state: 'available', reason: null });
  } catch (error) {
    return Object.freeze({
      embedder: { embed: async () => { throw new Error('face_model_indisponible'); } },
      state: 'unavailable',
      reason: `modele_facial_invalide:${String(error?.message ?? error).slice(0, 100)}`,
    });
  }
}
