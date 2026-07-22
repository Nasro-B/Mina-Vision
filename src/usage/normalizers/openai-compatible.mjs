import { createUsageAttempt, measured } from '../usage-schema.mjs';

export function normalizeOpenAiCompatibleUsage({ context, raw = {}, interrupted = false } = {}) {
  const inputTokens = measured(raw.prompt_tokens ?? raw.input_tokens);
  const outputTokens = measured(raw.completion_tokens ?? raw.output_tokens);
  return createUsageAttempt({
    context,
    raw,
    units: {
      inputTokens,
      cachedInputTokens: measured(raw.prompt_cache_hit_tokens ?? raw.prompt_tokens_details?.cached_tokens
        ?? raw.input_tokens_details?.cached_tokens),
      outputTokens,
      reasoningTokens: measured(raw.completion_tokens_details?.reasoning_tokens
        ?? raw.output_tokens_details?.reasoning_tokens),
      inputImages: measured(raw.input_images),
      inputAudioSeconds: measured(raw.input_audio_seconds),
      outputAudioSeconds: measured(raw.output_audio_seconds),
      localComputeMs: null,
    },
    completeness: interrupted || inputTokens === null || outputTokens === null ? 'partial' : 'final',
  });
}
