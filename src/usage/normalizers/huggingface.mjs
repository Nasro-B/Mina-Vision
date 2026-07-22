import { createUsageAttempt, measured } from '../usage-schema.mjs';

export function normalizeHuggingFaceUsage({ context, raw = {}, interrupted = false } = {}) {
  const inputTokens = measured(raw.input_tokens ?? raw.prompt_tokens);
  const outputTokens = measured(raw.output_tokens ?? raw.completion_tokens);
  return createUsageAttempt({
    context,
    raw,
    units: {
      inputTokens,
      cachedInputTokens: null,
      outputTokens,
      reasoningTokens: measured(raw.reasoning_tokens),
      inputImages: measured(raw.input_images),
      inputAudioSeconds: measured(raw.input_audio_seconds),
      outputAudioSeconds: measured(raw.output_audio_seconds),
      localComputeMs: null,
    },
    completeness: interrupted || inputTokens === null || outputTokens === null ? 'partial' : 'final',
  });
}
