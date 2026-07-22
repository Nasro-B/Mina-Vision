import { describe, expect, it, vi } from 'vitest';
import { createEnvDocumentStore, parseEnvDocument, updateEnvDocument } from '../src/config/env-document.mjs';

const ALLOWED = new Set([
  'MINA_INFERENCE_MODE', 'MINA_OFFLINE', 'LM_STUDIO_BASE_URL',
  'LM_STUDIO_TEXT_MODEL', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL',
]);

describe('preserving env document editor', () => {
  it('parses active values, last duplicates and CRLF without returning secrets', () => {
    const text = '# Mina Vision\r\n\r\nMINA_INFERENCE_MODE=auto\r\nMINA_INFERENCE_MODE="local-first"\r\nGEMINI_API_KEY=never-return\r\n';
    const parsed = parseEnvDocument(text);

    expect(parsed.newline).toBe('\r\n');
    expect(parsed.values).toEqual({ MINA_INFERENCE_MODE: 'local-first' });
    expect(JSON.stringify(parsed)).not.toContain('never-return');
  });

  it('replaces only the last active duplicate and preserves untouched bytes', () => {
    const original = '# commentaire\r\nMINA_INFERENCE_MODE=auto\r\n\r\nMINA_INFERENCE_MODE = "local-first"\r\nUNKNOWN = keep # intact\r\n';
    const updated = updateEnvDocument(original, {
      MINA_INFERENCE_MODE: 'local-only',
      DEEPSEEK_MODEL: 'deepseek-v4-pro',
    }, { allowedKeys: ALLOWED });

    expect(updated).toBe('# commentaire\r\nMINA_INFERENCE_MODE=auto\r\n\r\nMINA_INFERENCE_MODE = "local-only"\r\nUNKNOWN = keep # intact\r\nDEEPSEEK_MODEL=deepseek-v4-pro\r\n');
    expect(() => updateEnvDocument(original, { GEMINI_API_KEY: 'forbidden' }, { allowedKeys: ALLOWED }))
      .toThrow('env_key_not_editable:GEMINI_API_KEY');
  });

  it('persists through one injected atomic write without touching the real env', async () => {
    const writeAtomic = vi.fn(async () => {});
    const store = createEnvDocumentStore({
      path: 'C:\\temporary\\.env',
      readText: async () => 'MINA_OFFLINE=false\n',
      writeAtomic,
      allowedKeys: ALLOWED,
    });

    await store.update({ MINA_OFFLINE: 'true' });
    expect(writeAtomic).toHaveBeenCalledWith('C:\\temporary\\.env', 'MINA_OFFLINE=true\n');
  });
});
