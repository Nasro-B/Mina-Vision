import { describe, expect, it } from 'vitest';
import { normalizeGeminiUsage } from '../src/usage/normalizers/gemini.mjs';
import { normalizeOpenAiCompatibleUsage } from '../src/usage/normalizers/openai-compatible.mjs';
import { normalizeHuggingFaceUsage } from '../src/usage/normalizers/huggingface.mjs';
import { normalizeLocalUsage } from '../src/usage/normalizers/local.mjs';

const context = Object.freeze({
  attemptId: 'attempt-1',
  sessionId: 'session-1',
  correlationId: 'correlation-1',
  providerId: 'fixture',
  modelId: 'model-1',
  capability: 'text.generate',
  startedAt: '2026-07-15T06:00:00.000Z',
  endedAt: '2026-07-15T06:00:01.000Z',
  status: 'success',
  locality: 'cloud',
});

describe('usage normalizers', () => {
  it('normalizes Gemini cached, output, reasoning and image measures', () => {
    const result = normalizeGeminiUsage({
      context: { ...context, providerId: 'gemini' },
      raw: {
        usageMetadata: {
          promptTokenCount: 120,
          cachedContentTokenCount: 40,
          candidatesTokenCount: 31,
          thoughtsTokenCount: 8,
        },
        inputImages: 1,
      },
    });

    expect(result.units).toEqual({
      inputTokens: 120,
      cachedInputTokens: 40,
      outputTokens: 31,
      reasoningTokens: 8,
      inputImages: 1,
      inputAudioSeconds: null,
      outputAudioSeconds: null,
      localComputeMs: null,
    });
    expect(result.completeness).toBe('final');
    expect(result.rawDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.units)).toBe(true);
  });

  it.each([
    ['openrouter', { prompt_tokens: 20, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 3 } }, { inputTokens: 20, outputTokens: 7, cachedInputTokens: 3 }],
    ['deepseek', { prompt_tokens: 22, completion_tokens: 9, prompt_cache_hit_tokens: 4, completion_tokens_details: { reasoning_tokens: 5 } }, { inputTokens: 22, outputTokens: 9, cachedInputTokens: 4, reasoningTokens: 5 }],
    ['lm-studio', { prompt_tokens: 12, completion_tokens: 4 }, { inputTokens: 12, outputTokens: 4 }],
  ])('normalizes OpenAI-compatible %s usage', (providerId, raw, expected) => {
    const result = normalizeOpenAiCompatibleUsage({ context: { ...context, providerId }, raw });
    expect(result.units).toMatchObject(expected);
    expect(result.completeness).toBe('final');
  });

  it('keeps missing interrupted stream measures null and partial', () => {
    const result = normalizeOpenAiCompatibleUsage({
      context: { ...context, providerId: 'deepseek', status: 'error' },
      raw: { prompt_tokens: 4 },
      interrupted: true,
    });

    expect(result.units).toMatchObject({
      inputTokens: 4, cachedInputTokens: null, outputTokens: null, reasoningTokens: null,
    });
    expect(result.completeness).toBe('partial');
  });

  it.each([
    ['huggingface', { input_tokens: 10, output_tokens: 3 }, { inputTokens: 10, outputTokens: 3 }],
    ['modal', { prompt_tokens: 15, completion_tokens: 6 }, { inputTokens: 15, outputTokens: 6 }],
  ])('normalizes %s hosted inference without inventing unavailable fields', (providerId, raw, expected) => {
    const result = normalizeHuggingFaceUsage({ context: { ...context, providerId }, raw });
    expect(result.units).toMatchObject(expected);
    expect(result.units.cachedInputTokens).toBeNull();
  });

  it.each([
    ['local-ocr', 'ocr.extract', { inputImages: 1, localComputeMs: 41 }, { inputImages: 1, localComputeMs: 41 }],
    ['local-stt', 'voice.transcribe', { audioSeconds: 2.5, localComputeMs: 80, completeness: 'final' }, { inputAudioSeconds: 2.5, localComputeMs: 80 }],
    ['local-tts', 'voice.synthesize', { audioSeconds: 1.25, localComputeMs: 60, completeness: 'partial' }, { outputAudioSeconds: 1.25, localComputeMs: 60 }],
  ])('normalizes specialized local usage for %s', (providerId, capability, raw, expected) => {
    const result = normalizeLocalUsage({
      context: { ...context, providerId, capability, locality: 'local' },
      raw,
    });
    expect(result.units).toMatchObject(expected);
    expect(result.units.inputTokens).toBeNull();
    expect(result.completeness).toBe(raw.completeness ?? 'final');
  });

  it('rejects invalid identifiers, negative units and secret-bearing raw persistence', () => {
    expect(() => normalizeLocalUsage({ context: { ...context, attemptId: '' }, raw: { localComputeMs: 1 } }))
      .toThrow('usage_attempt_invalid');
    expect(() => normalizeLocalUsage({ context, raw: { localComputeMs: -1 } }))
      .toThrow('usage_units_invalid');
    const result = normalizeLocalUsage({ context: { ...context, locality: 'local' }, raw: { localComputeMs: 1, token: 'secret' } });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result).not.toHaveProperty('raw');
  });
});
