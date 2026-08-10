import { describe, expect, it, vi } from 'vitest';
import { createLocalAsrPipelineLoader } from '../src/chat/local-asr-pipeline-loader.mjs';

describe('createLocalAsrPipelineLoader', () => {
  it('transmet q8 et local-only au chargeur Transformers', async () => {
    const pipeline = vi.fn(async () => async () => ({ text: 'ok' }));
    const loader = createLocalAsrPipelineLoader({
      loadTransformers: async () => ({ pipeline }),
    });

    const asr = await loader('Xenova/whisper-small', { localFilesOnly: true, dtype: 'q8' });

    await expect(asr(new Float32Array())).resolves.toEqual({ text: 'ok' });
    expect(pipeline).toHaveBeenCalledWith('automatic-speech-recognition', 'Xenova/whisper-small', {
      dtype: 'q8', local_files_only: true,
    });
  });
});
