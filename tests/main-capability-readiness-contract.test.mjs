import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('capability readiness composition contract', () => {
  it('uses the shared readiness mapper for LM Studio and Android at Electron boot', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');

    expect(source).toContain("import { capabilityFromReadiness } from '../diagnostics/capability-readiness.mjs';");
    expect(source).toContain("reportCapabilityFromReadiness('models.lm_studio'");
    expect(source).toContain("reportCapabilityFromReadiness('computer_use.android'");
    expect(source).not.toContain("reportCapability('computer_use.android', 'available');");
  });

  it('uses the same mapper in the read-only verification CLI', async () => {
    const source = await readFile(new URL('../scripts/verify-mina.mjs', import.meta.url), 'utf8');

    expect(source).toContain("import { capabilityFromReadiness } from '../src/diagnostics/capability-readiness.mjs';");
    expect(source).toContain("'models.lm_studio'");
    expect(source).toContain("'computer_use.android'");
    expect(source).toContain('capabilities:');
  });
});
