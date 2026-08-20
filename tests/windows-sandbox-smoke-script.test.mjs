import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildSmokeJob,
  createSmokeSource,
  shouldRetrySandboxSmokeError,
} from '../scripts/run-windows-sandbox-smoke.mjs';

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

describe('Windows Sandbox smoke script contract', () => {
  it('builds a local JavaScript job with networking disabled and one exported artifact', () => {
    const source = createSmokeSource();
    const job = buildSmokeJob({ sourceDigest: sha256(source) });

    expect(source).toContain('MINA_SANDBOX_OK');
    expect(source).toContain('C:/Mina/out/result.txt');
    expect(job).toMatchObject({
      language: 'javascript',
      entrypoint: 'main.js',
      network: false,
      exports: ['out/result.txt'],
      profile: 'small',
    });
    expect(job.sourceFiles).toEqual([{ path: 'main.js', digest: sha256(source), mode: 'read-only' }]);
  });

  it('exposes the physical smoke recipe as an explicit npm script', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

    expect(pkg.scripts['smoke:sandbox']).toBe('node scripts/run-windows-sandbox-smoke.mjs');
  });

  it('retries only Windows Sandbox startup errors', () => {
    expect(shouldRetrySandboxSmokeError(new Error('sandbox_start_failed:Le fichier spécifié est introuvable. (0x80070002)'))).toBe(true);
    expect(shouldRetrySandboxSmokeError(new Error('sandbox_smoke_artifact_invalid'))).toBe(false);
  });
});
