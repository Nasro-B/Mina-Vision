import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installModelManifest } from '../src/models/model-installer.mjs';

const cleanups = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe('explicit local model installer', () => {
  it('installs only manifest files whose SHA-256 matches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mina-model-'));
    cleanups.push(root);
    const bytes = Buffer.from('validated local model');
    const installPath = join(root, 'installed');
    const result = await installModelManifest({
      manifest: {
        id: 'manifest-selected-model', installPath, revision: 'abc123', license: 'apache-2.0',
        files: [{ url: 'https://models.example/model.bin', path: 'onnx/model.bin', sha256: createHash('sha256').update(bytes).digest('hex') }],
      },
      fetchImpl: async () => new Response(bytes, { status: 200 }),
      authorized: true,
      networkEnabled: true,
    });

    expect(result).toEqual({ id: 'manifest-selected-model', installPath, files: 1 });
    expect(await readFile(join(installPath, 'onnx', 'model.bin'))).toEqual(bytes);
  });

  it('removes partial files and rejects a digest mismatch or path traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mina-model-'));
    cleanups.push(root);
    const installPath = join(root, 'installed');
    await expect(installModelManifest({
      manifest: {
        id: 'bad-digest', installPath, revision: 'abc123', license: 'apache-2.0',
        files: [{ url: 'https://models.example/model.bin', path: 'model.bin', sha256: '0'.repeat(64) }],
      },
      fetchImpl: async () => new Response('altered', { status: 200 }),
      authorized: true, networkEnabled: true,
    })).rejects.toThrow('model_digest_mismatch');
    await expect(installModelManifest({
      manifest: {
        id: 'traversal', installPath, revision: 'abc123', license: 'apache-2.0',
        files: [{ url: 'https://models.example/model.bin', path: '../escape.bin', sha256: '0'.repeat(64) }],
      },
      fetchImpl: async () => new Response('x', { status: 200 }),
      authorized: true, networkEnabled: true,
    })).rejects.toThrow('model_file_path_invalid');
  });

  it('requires an explicit local authorization, network enablement, revision and license', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mina-model-'));
    cleanups.push(root);
    const base = {
      id: 'guarded', installPath: join(root, 'installed'), revision: 'abc123', license: 'mit',
      files: [{ url: 'https://models.example/model.bin', path: 'model.bin', sha256: '0'.repeat(64) }],
    };
    await expect(installModelManifest({ manifest: base })).rejects.toThrow('model_install_authorization_required');
    await expect(installModelManifest({ manifest: base, authorized: true })).rejects.toThrow('model_install_network_disabled');
    await expect(installModelManifest({ manifest: { ...base, license: '' }, authorized: true, networkEnabled: true }))
      .rejects.toThrow('model_manifest_license_required');
  });
});
