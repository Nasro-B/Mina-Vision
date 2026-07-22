import { createUsageAttempt, measured } from '../usage-schema.mjs';

export function normalizeGeminiUsage({ context, raw = {}, interrupted = false } = {}) {
  const usage = raw.usageMetadata ?? raw.usage_metadata ?? {};
  const outputTokens = measured(usage.candidatesTokenCount ?? usage.candidates_token_count);
  return createUsageAttempt({
    context,
    raw,
    units: {
      inputTokens: measured(usage.promptTokenCount ?? usage.prompt_token_count),
      cachedInputTokens: measured(usage.cachedContentTokenCount ?? usage.cached_content_token_count),
      outputTokens,
      reasoningTokens: measured(usage.thoughtsTokenCount ?? usage.thoughts_token_count),
      inputImages: measured(raw.inputImages),
      inputAudioSeconds: measured(raw.inputAudioSeconds),
      outputAudioSeconds: measured(raw.outputAudioSeconds),
      localComputeMs: null,
    },
    completeness: interrupted || outputTokens === null ? 'partial' : 'final',
  });
}
