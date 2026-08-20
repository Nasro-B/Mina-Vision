import { describe, expect, it, vi } from 'vitest';
import { probeFirebaseCloudReadOnly } from '../src/diagnostics/firebase-cloud-proof.mjs';

describe('probeFirebaseCloudReadOnly', () => {
  it('proves Storage metadata and RTDB reachability without returning secrets or database content', async () => {
    const tokenProvider = { getAccessToken: vi.fn(async () => 'ya29.fixture-token') };
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).startsWith('https://storage.googleapis.com/storage/v1/b/')) {
        return new Response(JSON.stringify({ name: 'mina-vision.firebasestorage.app', location: 'US-CENTRAL1', storageClass: 'REGIONAL' }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    });

    const result = await probeFirebaseCloudReadOnly({
      projectId: 'mina-vision',
      storageBucket: 'mina-vision.firebasestorage.app',
      databaseUrl: 'https://mina-vision-default-rtdb.europe-west1.firebasedatabase.app',
      tokenProvider,
      fetchImpl,
      timeoutMs: 1_000,
    });

    expect(result).toEqual({
      ready: true,
      configured: true,
      projectId: 'mina-vision',
      storage: { ready: true, bucket: 'mina-vision.firebasestorage.app', location: 'US-CENTRAL1', storageClass: 'REGIONAL' },
      rtdb: { ready: true, host: 'mina-vision-default-rtdb.europe-west1.firebasedatabase.app', status: 204 },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://mina-vision-default-rtdb.europe-west1.firebasedatabase.app/.json?print=silent&timeout=3s',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(JSON.stringify(result)).not.toContain('fixture-token');
  });

  it('fails closed when Storage cannot be proven and does not probe RTDB afterwards', async () => {
    const fetchImpl = vi.fn(async () => new Response('forbidden', { status: 403 }));
    await expect(probeFirebaseCloudReadOnly({
      projectId: 'mina-vision',
      storageBucket: 'mina-vision.firebasestorage.app',
      databaseUrl: 'https://mina-vision-default-rtdb.europe-west1.firebasedatabase.app',
      tokenProvider: { getAccessToken: vi.fn(async () => 'token') },
      fetchImpl,
    })).resolves.toMatchObject({
      ready: false,
      configured: true,
      reason: 'firebase_storage_cloud_unverified:403',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
