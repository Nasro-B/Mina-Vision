import { describe, expect, it } from 'vitest';
import { applyLocalVoiceOfflinePolicy } from '../src/voice/local-voice-offline-policy.mjs';

describe('local voice offline policy', () => {
  it('rejects a remote fetch when Mina starts offline', async () => {
    const runtime = { fetch: async () => 'network response' };

    applyLocalVoiceOfflinePolicy({ offline: true, runtime });

    await expect(runtime.fetch('https://huggingface.co/model')).rejects.toThrow('local_voice_network_forbidden');
  });

  it('leaves fetch usable outside offline mode', async () => {
    const runtime = { fetch: async () => 'network response' };

    applyLocalVoiceOfflinePolicy({ offline: false, runtime });

    await expect(runtime.fetch('https://huggingface.co/model')).resolves.toBe('network response');
  });
});
