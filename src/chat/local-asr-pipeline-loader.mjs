export function createLocalAsrPipelineLoader({
  loadTransformers = () => import('@huggingface/transformers'),
} = {}) {
  if (typeof loadTransformers !== 'function') throw new TypeError('local_asr_transformers_loader_required');

  return async function loadPipeline(model, { localFilesOnly = false, dtype = 'q8' } = {}) {
    const { pipeline } = await loadTransformers();
    if (typeof pipeline !== 'function') throw new Error('local_asr_pipeline_unavailable');
    const asr = await pipeline('automatic-speech-recognition', model, {
      dtype,
      local_files_only: localFilesOnly,
    });
    return async (pcm) => asr(pcm);
  };
}
