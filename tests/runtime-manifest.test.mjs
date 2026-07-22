import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeManifest } from '../src/sandbox/runtime-manifest.mjs';

let root;
let manifestPath;

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeManifest(overrides = {}) {
  const runtimes = [];
  for (const [language, filename, version] of [
    ['python', 'python/python.exe', '3.13.5'],
    ['javascript', 'node/node.exe', '22.14.0'],
    ['powershell', 'powershell/pwsh.exe', '7.5.2'],
  ]) {
    const bytes = Buffer.from(`${language}-${version}`);
    const full = join(root, ...filename.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, bytes);
    runtimes.push({
      language, version, path: filename, sha256: sha(bytes),
      sourceUrl: `https://official.example/${language}/${version}`,
    });
  }
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, runtimes, ...overrides }));
  return runtimes;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mina-runtimes-'));
  manifestPath = join(root, 'manifest.json');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('pinned portable runtime manifest', () => {
  it('verifies every required runtime by exact SHA-256 without executing it', async () => {
    await writeManifest();
    const manifest = createRuntimeManifest({ manifestPath, runtimeRoot: root });
    const result = await manifest.verify();
    expect(result.available).toBe(true);
    expect(result.runtimes.map(({ language, verified }) => [language, verified])).toEqual([
      ['python', true], ['javascript', true], ['powershell', true],
    ]);
    expect(manifest.resolve('python')).toBe(join(root, 'python', 'python.exe'));
  });

  it('fails closed on missing, changed, escaping or incomplete runtime files', async () => {
    const runtimes = await writeManifest();
    await writeFile(join(root, 'node', 'node.exe'), 'tampered');
    await expect(createRuntimeManifest({ manifestPath, runtimeRoot: root }).verify())
      .resolves.toMatchObject({ available: false, reason: 'runtime_digest_mismatch:javascript' });

    runtimes[0].path = '../host-python.exe';
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, runtimes }));
    await expect(createRuntimeManifest({ manifestPath, runtimeRoot: root }).verify())
      .resolves.toMatchObject({ available: false, reason: 'runtime_path_invalid:python' });

    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, runtimes: runtimes.slice(0, 2) }));
    await expect(createRuntimeManifest({ manifestPath, runtimeRoot: root }).verify())
      .resolves.toMatchObject({ available: false, reason: 'runtime_manifest_incomplete' });
  });
});
