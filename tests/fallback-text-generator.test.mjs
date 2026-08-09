import { describe, expect, it, vi } from 'vitest';
import { createFallbackTextGenerator } from '../src/providers/fallback-text-generator.mjs';

const provider = (id, locality, generate) => ({ id, locality, generate: vi.fn(generate) });

describe('fallback text generator', () => {
  it('uses cloud first in auto mode and falls back to local', async () => {
    const cloud = provider('cloud', 'cloud', async () => { throw new Error('cloud_down'); });
    const local = provider('local', 'local', async () => ({ output: 'local ok' }));
    const generator = createFallbackTextGenerator({ providers: [cloud, local], mode: 'auto' });

    await expect(generator.generate({ messages: [] })).resolves.toEqual({ output: 'local ok' });
    expect(cloud.generate.mock.invocationCallOrder[0]).toBeLessThan(local.generate.mock.invocationCallOrder[0]);
  });

  it('uses local first in local-first mode and excludes cloud in local-only mode', async () => {
    const cloud = provider('cloud', 'cloud', async () => ({ output: 'cloud ok' }));
    const local = provider('local', 'local', async () => ({ output: 'local ok' }));

    await expect(createFallbackTextGenerator({ providers: [cloud, local], mode: 'local-first' })
      .generate({ messages: [] })).resolves.toEqual({ output: 'local ok' });
    expect(cloud.generate).not.toHaveBeenCalled();

    local.generate.mockRejectedValue(new Error('local_down'));
    await expect(createFallbackTextGenerator({ providers: [cloud, local], mode: 'local-only' })
      .generate({ messages: [] })).rejects.toThrow('text_providers_failed:local');
    expect(cloud.generate).not.toHaveBeenCalled();
  });

  it('cools down a rate-limited cloud provider while local fallback remains available', async () => {
    let clock = 1_000;
    const limited = Object.assign(new Error('429 Rate limit exceeded'), { status: 429 });
    const cloud = provider('cloud', 'cloud', async () => { throw limited; });
    const local = provider('local', 'local', async () => ({ output: 'local ok' }));
    const generator = createFallbackTextGenerator({
      providers: [cloud, local], mode: 'auto', now: () => clock, rateLimitCooldownMs: 60_000,
    });

    await expect(generator.generate({ messages: [] })).resolves.toEqual({ output: 'local ok' });
    await expect(generator.generate({ messages: [] })).resolves.toEqual({ output: 'local ok' });
    expect(cloud.generate).toHaveBeenCalledTimes(1);
    expect(local.generate).toHaveBeenCalledTimes(2);

    clock += 60_001;
    await expect(generator.generate({ messages: [] })).resolves.toEqual({ output: 'local ok' });
    expect(cloud.generate).toHaveBeenCalledTimes(2);
  });

  it('cools down a transient 5xx or empty provider response without delaying the local fallback', async () => {
    let clock = 10_000;
    const unavailable = Object.assign(new Error('503 status code (no body)'), { status: 503 });
    const cloud = provider('modal', 'cloud', async () => { throw unavailable; });
    const local = provider('lmstudio', 'local', async () => ({ output: 'local ok' }));
    const generator = createFallbackTextGenerator({
      providers: [cloud, local], mode: 'auto', now: () => clock, transientCooldownMs: 30_000,
    });

    await expect(generator.generate({ messages: [] })).resolves.toEqual({ output: 'local ok' });
    await expect(generator.generate({ messages: [] })).resolves.toEqual({ output: 'local ok' });
    expect(cloud.generate).toHaveBeenCalledTimes(1);

    clock += 30_001;
    cloud.generate.mockRejectedValueOnce(new Error('modal_text_empty'));
    await expect(generator.generate({ messages: [] })).resolves.toEqual({ output: 'local ok' });
    await expect(generator.generate({ messages: [] })).resolves.toEqual({ output: 'local ok' });
    expect(cloud.generate).toHaveBeenCalledTimes(2);
    expect(local.generate).toHaveBeenCalledTimes(4);
  });

  it('honors an explicit Retry-After (seconds) on a 429 instead of the default cooldown', async () => {
    let clock = 1_000;
    const limited = Object.assign(new Error('429 Too Many Requests'), {
      status: 429, headers: { get: (name) => (name === 'retry-after' ? '5' : null) },
    });
    const cloud = provider('cloud', 'cloud', async () => { throw limited; });
    const local = provider('local', 'local', async () => ({ output: 'local ok' }));
    const generator = createFallbackTextGenerator({
      providers: [cloud, local], mode: 'auto', now: () => clock, rateLimitCooldownMs: 300_000,
    });

    await generator.generate({ messages: [] });
    clock += 5_001; // past the 5s Retry-After, well before the 300s default cooldown
    await expect(generator.generate({ messages: [] })).resolves.toEqual({ output: 'local ok' });
    expect(cloud.generate).toHaveBeenCalledTimes(2);
  });

  it('bounds an absurd Retry-After to one hour instead of trusting it blindly', async () => {
    let clock = 1_000;
    const limited = Object.assign(new Error('429'), {
      status: 429, headers: { get: (name) => (name === 'retry-after' ? '999999' : null) },
    });
    const cloud = provider('cloud', 'cloud', async () => { throw limited; });
    const local = provider('local', 'local', async () => ({ output: 'local ok' }));
    const generator = createFallbackTextGenerator({ providers: [cloud, local], mode: 'auto', now: () => clock });

    await generator.generate({ messages: [] });
    clock += 3_600_000 + 1; // one hour ceiling elapsed
    await expect(generator.generate({ messages: [] })).resolves.toEqual({ output: 'local ok' });
    expect(cloud.generate).toHaveBeenCalledTimes(2);
  });

  it('transmet les deltas natifs mais ne mélange jamais deux fournisseurs après un fragment', async () => {
    const cloud = provider('cloud', 'cloud', async ({ onDelta }) => {
      await onDelta('début');
      throw new Error('cloud_down');
    });
    const local = provider('local', 'local', async () => ({ output: 'ne doit pas être envoyé' }));
    const generator = createFallbackTextGenerator({ providers: [cloud, local], mode: 'auto' });
    const onDelta = vi.fn(async () => {});

    await expect(generator.generate({ messages: [], stream: true, onDelta })).rejects.toThrow('cloud_down');
    expect(onDelta).toHaveBeenCalledWith('début');
    expect(local.generate).not.toHaveBeenCalled();
  });

  it('ne bascule pas non plus si un fournisseur n’attend pas la promesse de son delta', async () => {
    const cloud = provider('cloud', 'cloud', async ({ onDelta }) => {
      void onDelta('début');
      throw new Error('cloud_down');
    });
    const local = provider('local', 'local', async () => ({ output: 'ne doit pas être envoyé' }));
    const generator = createFallbackTextGenerator({ providers: [cloud, local], mode: 'auto' });
    let releaseDelta;
    const gate = new Promise((resolve) => { releaseDelta = resolve; });
    const onDelta = vi.fn(async () => { await gate; });

    const pending = generator.generate({ messages: [], stream: true, onDelta });
    const rejected = expect(pending).rejects.toThrow('cloud_down');
    await vi.waitFor(() => expect(onDelta).toHaveBeenCalledWith('début'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseDelta();
    await rejected;
    expect(local.generate).not.toHaveBeenCalled();
  });

  it('laisse un fournisseur final-only retourner son final sans fragment synthétique', async () => {
    const finalOnly = provider('gemini', 'cloud', async () => ({ output: 'final réel' }));
    const generator = createFallbackTextGenerator({ providers: [finalOnly], mode: 'auto' });
    const onDelta = vi.fn(async () => {});

    await expect(generator.generate({ messages: [], stream: true, onDelta })).resolves.toEqual({ output: 'final réel' });
    expect(finalOnly.generate).toHaveBeenCalledWith(expect.objectContaining({ stream: true, onDelta: expect.any(Function) }));
    expect(onDelta).not.toHaveBeenCalled();
  });
});
