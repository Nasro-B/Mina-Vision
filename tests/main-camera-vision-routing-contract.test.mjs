import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('main camera vision routing contract', () => {
  it('routes live camera analysis through the configured fallback runtime', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');

    expect(source).toContain('createCameraVisionRuntime');
    expect(source).toContain('cameraVisionRuntime.cameraVision');
    expect(source).not.toContain('createGeminiCameraVision({ apiKey: requireRotatedCredentials().geminiApiKey })');
  });
});
