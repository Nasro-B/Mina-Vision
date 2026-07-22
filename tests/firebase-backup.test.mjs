import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createFirebaseBackup, createFirebaseSdkClient } from '../src/backup/firebase-backup.mjs';

function createClient() {
  const objects = new Map();
  return {
    authenticate: vi.fn(async (token) => ({ uid: token === 'valid-token' ? 'owner-1' : 'other' })),
    put: vi.fn(async (path, bytes) => { objects.set(path, Buffer.from(bytes)); }),
    get: vi.fn(async (path) => objects.get(path) ?? null),
    exists: vi.fn(async (path) => objects.has(path)),
    delete: vi.fn(async (path) => { objects.delete(path); }),
    list: vi.fn(async (prefix) => [...objects.keys()].filter((key) => key.startsWith(prefix))),
    inspect: () => objects,
  };
}

describe('Firebase ciphertext adapter', () => {
  it('authenticates the owner and scopes every object to owner and paired device', async () => {
    const client = createClient();
    const remote = createFirebaseBackup({
      client,
      authTokenProvider: async () => 'valid-token',
      expectedOwnerId: 'owner-1',
      deviceId: 'huawei-paired',
    });
    await remote.putObject('blobs/abc', Buffer.from('ciphertext'));

    expect(client.authenticate).toHaveBeenCalledWith('valid-token');
    expect([...client.inspect().keys()]).toEqual(['owners/owner-1/devices/huawei-paired/blobs/abc']);
    await expect(remote.getObject('blobs/abc')).resolves.toEqual(Buffer.from('ciphertext'));
  });

  it('fails closed for another owner, traversal or non-byte uploads', async () => {
    const client = createClient();
    const wrongOwner = createFirebaseBackup({
      client,
      authTokenProvider: async () => 'wrong-token',
      expectedOwnerId: 'owner-1',
      deviceId: 'device-1',
    });
    await expect(wrongOwner.putObject('blobs/a', Buffer.from('x'))).rejects.toThrow('firebase_owner_mismatch');

    const remote = createFirebaseBackup({
      client,
      authTokenProvider: async () => 'valid-token',
      expectedOwnerId: 'owner-1',
      deviceId: 'device-1',
    });
    await expect(remote.putObject('../escape', Buffer.from('x'))).rejects.toThrow('firebase_object_key_invalid');
    await expect(remote.putObject('blobs/plain', 'plaintext')).rejects.toThrow('firebase_ciphertext_bytes_required');
  });

  it('initializes App Check when provided and rejects service credentials in client config', async () => {
    const sdk = {
      initializeApp: vi.fn(() => ({ name: 'mina-backup' })),
      initializeAppCheck: vi.fn(),
      getAuth: vi.fn(() => ({})),
      getStorage: vi.fn(() => ({})),
    };
    const config = {
      apiKey: 'public-api-key', authDomain: 'owner.firebaseapp.com', projectId: 'owner',
      storageBucket: 'owner.firebasestorage.app', appId: 'public-app-id',
    };
    await createFirebaseSdkClient({ config, appCheckProvider: { provider: true }, sdkLoader: async () => sdk });

    expect(sdk.initializeAppCheck).toHaveBeenCalledWith(expect.anything(), {
      provider: { provider: true }, isTokenAutoRefreshEnabled: true,
    });
    await expect(createFirebaseSdkClient({
      config: { ...config, privateKey: 'forbidden' }, sdkLoader: async () => sdk,
    })).rejects.toThrow('firebase_service_credentials_forbidden');
  });

  it('ships owner-only Storage rules with a default deny', async () => {
    const rules = await readFile(new URL('../firebase.storage.rules', import.meta.url), 'utf8');
    expect(rules).toContain('request.auth.uid == ownerId');
    expect(rules).toContain('allow read, write: if false;');
  });
});
