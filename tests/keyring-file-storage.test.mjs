import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createKeyringFileStorage } from '../src/crypto/keyring-file-storage.mjs';

const cleanups = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe('keyring file storage', () => {
  it('writes the record and rotation journal atomically without plaintext key material', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mina-keyring-storage-'));
    cleanups.push(root);
    const filename = join(root, 'keyring.json');
    const storage = createKeyringFileStorage({ filename });

    await storage.writeAtomic({ version: 1, wrappedMasterKey: 'DPAPI_WRAPPED' });
    await storage.writeRotationAtomic({ status: 'reencrypting', processed: 7 });
    expect(await storage.read()).toEqual({ version: 1, wrappedMasterKey: 'DPAPI_WRAPPED' });
    expect(await storage.readRotation()).toEqual({ status: 'reencrypting', processed: 7 });
    expect(await readFile(filename, 'utf8')).not.toContain('.tmp');

    await storage.clearRotation();
    expect(await storage.readRotation()).toBeNull();
  });
});
