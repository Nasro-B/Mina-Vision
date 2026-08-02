import { describe, expect, it, vi } from 'vitest';
import { probeFirebaseBackupConfiguration } from '../src/diagnostics/firebase-health.mjs';

const projectId = 'mina-vision';
const storageBucket = 'mina-vision.firebasestorage.app';
const googleServices = JSON.stringify({
  project_info: { project_id: projectId, storage_bucket: storageBucket },
  client: [{
    client_info: { android_client_info: { package_name: 'fr.mina.gateway' } },
    api_key: [{ current_key: 'public-api-key' }],
  }],
});

function reader(entries) {
  return vi.fn(async (filename) => {
    if (entries.has(filename)) return entries.get(filename);
    const error = new Error('missing');
    error.code = 'ENOENT';
    throw error;
  });
}

describe('Firebase backup configuration health', () => {
  it('reports missing project settings without reading credentials', async () => {
    const readText = vi.fn();
    await expect(probeFirebaseBackupConfiguration({ readText })).resolves.toEqual({
      ready: false,
      configured: false,
      reason: 'firebase_unconfigured',
    });
    expect(readText).not.toHaveBeenCalled();
  });

  it('keeps a matching local configuration degraded until a cloud proof exists', async () => {
    const readText = reader(new Map([
      ['google-services.json', googleServices],
      ['service-account.json', JSON.stringify({
        project_id: projectId,
        client_email: 'mina@mina-vision.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----fixture',
      })],
    ]));

    await expect(probeFirebaseBackupConfiguration({
      projectId,
      storageBucket,
      googleServicesPath: 'google-services.json',
      serviceAccountPath: 'service-account.json',
      readText,
    })).resolves.toEqual({
      ready: false,
      configured: true,
      reason: 'firebase_cloud_unverified',
    });
  });

  it('rejects a service account from another project before a cloud call', async () => {
    const readText = reader(new Map([
      ['google-services.json', googleServices],
      ['service-account.json', JSON.stringify({
        project_id: 'mina-vission',
        client_email: 'mina@mina-vission.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----fixture',
      })],
    ]));

    await expect(probeFirebaseBackupConfiguration({
      projectId,
      storageBucket,
      googleServicesPath: 'google-services.json',
      serviceAccountPath: 'service-account.json',
      readText,
    })).resolves.toEqual({
      ready: false,
      configured: false,
      reason: 'firebase_service_account_project_mismatch',
    });
  });

  it('keeps the health diagnostic safe when the Android client list is malformed', async () => {
    const readText = reader(new Map([
      ['google-services.json', JSON.stringify({
        project_info: { project_id: projectId, storage_bucket: storageBucket },
        client: {},
      })],
      ['service-account.json', JSON.stringify({
        project_id: projectId,
        client_email: 'mina@mina-vision.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----fixture',
      })],
    ]));

    await expect(probeFirebaseBackupConfiguration({
      projectId,
      storageBucket,
      googleServicesPath: 'google-services.json',
      serviceAccountPath: 'service-account.json',
      readText,
    })).resolves.toEqual({
      ready: false,
      configured: false,
      reason: 'firebase_google_services_android_client_unavailable',
    });
  });
});
