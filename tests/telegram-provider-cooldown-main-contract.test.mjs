import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Telegram provider cooldown runtime wiring', () => {
  it('reuses one fallback generator and resets it only after settings change', () => {
    const main = readFileSync(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');

    expect(main).toContain('let telegramTextGeneratorInstance = null;');
    expect(main).toContain('if (telegramTextGeneratorInstance) return telegramTextGeneratorInstance;');
    expect(main).toContain('telegramTextGeneratorInstance = createFallbackTextGenerator({');
    expect(main).toContain('telegramTextGeneratorInstance = null;');
  });
});
