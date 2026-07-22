import { createUsageAttempt, measured } from '../usage-schema.mjs';

export function normalizeLocalUsage({ context, raw = {}, interrupted = false } = {}) {
  const capability = context?.capability ?? '';
  return createUsageAttempt({
    context,
    raw,
    units: {
      inputTokens: measured(raw.inputTokens),
      cachedInputTokens: measured(raw.cachedInputTokens),
      outputTokens: measured(raw.outputTokens),
      reasoningTokens: measured(raw.reasoningTokens),
      inputImages: measured(raw.inputImages),
      inputAudioSeconds: measured(raw.inputAudioSeconds
        ?? (capability === 'voice.transcribe' ? raw.audioSeconds : null)),
      outputAudioSeconds: measured(raw.outputAudioSeconds
        ?? (capability === 'voice.synthesize' ? raw.audioSeconds : null)),
      localComputeMs: measured(raw.localComputeMs),
    },
    completeness: interrupted ? 'partial' : raw.completeness ?? 'final',
  });
}
