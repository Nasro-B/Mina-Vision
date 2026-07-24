// Embedder de visage RÉEL : relie le décodage d'image (sharp) au modèle ONNX (face-model-loader).
// Jusqu'ici un stub jetait `face_embedding_pipeline_not_implemented` — la reconnaissance faciale ne
// pouvait donc JAMAIS produire un faux résultat (fail-closed volontaire). Ce module remplace le stub
// par un vrai pipeline, MAIS reste piloté par un MANIFESTE : la taille d'entrée, la normalisation et
// la disposition des canaux viennent du modèle provisionné, jamais d'hypothèses codées en dur. Un
// modèle biométrique mal préprocessé donnerait une auth dangereuse ; déléguer au manifeste garantit
// que seul un modèle validé (avec ses paramètres exacts) est utilisé.

function validateEmbedderManifest(manifest) {
  const pre = manifest?.preprocess ?? {};
  const okDim = (value) => Number.isInteger(value) && value >= 4 && value <= 1024;
  const okTriplet = (value) => Array.isArray(value) && value.length === 3 && value.every((n) => Number.isFinite(n));
  if (!okDim(pre.inputWidth) || !okDim(pre.inputHeight) || !okTriplet(pre.mean) || !okTriplet(pre.std)
    || !['nchw', 'nhwc'].includes(pre.layout) || pre.std.some((s) => s === 0)
    || typeof manifest?.inputName !== 'string' || typeof manifest?.outputName !== 'string') {
    throw new TypeError('face_embedder_manifest_invalid');
  }
  return manifest;
}

/**
 * @param {object}   opts
 * @param {object}   opts.loader        face-model-loader chargé (expose run(id, feeds))
 * @param {object}   opts.manifest      manifeste modèle + preprocess { inputWidth, inputHeight, mean, std, layout }
 * @param {Function} opts.sharpImpl     fabrique sharp (image) => pipeline .resize().removeAlpha().raw().toBuffer({resolveWithObject})
 * @param {Function} opts.createTensor  (type, data, dims) => Tensor onnxruntime
 */
export function createFaceEmbedder({ loader, manifest, sharpImpl, createTensor } = {}) {
  if (!loader?.run || typeof sharpImpl !== 'function' || typeof createTensor !== 'function') {
    throw new TypeError('face_embedder_dependencies_required');
  }
  const validated = validateEmbedderManifest(manifest);
  const { inputWidth: w, inputHeight: h, mean, std, layout } = validated.preprocess;

  async function embed({ image } = {}) {
    if (!image) throw new TypeError('face_embedder_image_required');
    // Décodage + redimensionnement déterministe, 3 canaux RGB, pixels bruts.
    const { data } = await sharpImpl(image)
      .resize(w, h, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (data.length < w * h * 3) throw new Error('face_embedder_decode_failed');

    const tensor = new Float32Array(w * h * 3);
    // NCHW : [1,3,H,W] ; NHWC : [1,H,W,3]. Normalisation (pixel/255 - mean)/std par canal.
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const src = (y * w + x) * 3;
        for (let c = 0; c < 3; c += 1) {
          const value = (data[src + c] / 255 - mean[c]) / std[c];
          const dst = layout === 'nchw' ? c * h * w + y * w + x : (y * w + x) * 3 + c;
          tensor[dst] = value;
        }
      }
    }
    const dims = layout === 'nchw' ? [1, 3, h, w] : [1, h, w, 3];
    const output = await loader.run(validated.id, { [validated.inputName]: createTensor('float32', tensor, dims) });
    const vector = output?.[validated.outputName]?.data;
    if (!vector || vector.length < 1) throw new Error('face_embedder_no_output');
    return Array.from(vector);
  }

  return Object.freeze({ embed });
}
