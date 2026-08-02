import { readFile } from 'node:fs/promises';

function unavailable(reason, configured = false) {
  return Object.freeze({ ready: false, configured, reason });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function probeFirebaseBackupConfiguration({
  projectId,
  storageBucket,
  googleServicesPath,
  serviceAccountPath = null,
  tokenEndpoint = null,
  readText = readFile,
} = {}) {
  if (!projectId || !storageBucket) return unavailable('firebase_unconfigured');
  if (typeof readText !== 'function') throw new TypeError('firebase_health_read_text_required');

  let googleServices;
  try {
    googleServices = parseJson(await readText(googleServicesPath, 'utf8'));
  } catch {
    return unavailable('firebase_google_services_unavailable');
  }
  if (!googleServices) return unavailable('firebase_google_services_invalid');
  if (googleServices?.project_info?.project_id !== projectId) {
    return unavailable('firebase_google_services_project_mismatch');
  }
  if (googleServices?.project_info?.storage_bucket !== storageBucket) {
    return unavailable('firebase_google_services_bucket_mismatch');
  }
  const androidClient = Array.isArray(googleServices.client) && googleServices.client.find((client) => (
    client?.client_info?.android_client_info?.package_name === 'fr.mina.gateway'
      && typeof client?.api_key?.[0]?.current_key === 'string'
      && client.api_key[0].current_key.length > 0
  ));
  if (!androidClient) return unavailable('firebase_google_services_android_client_unavailable');

  if (serviceAccountPath) {
    let serviceAccount;
    try {
      serviceAccount = parseJson(await readText(serviceAccountPath, 'utf8'));
    } catch {
      if (!tokenEndpoint) return unavailable('firebase_service_account_unavailable');
    }
    if (serviceAccount) {
      if (serviceAccount.project_id !== projectId) return unavailable('firebase_service_account_project_mismatch');
      if (typeof serviceAccount.client_email !== 'string' || !serviceAccount.client_email.includes('@')) {
        return unavailable('firebase_service_account_invalid');
      }
      if (typeof serviceAccount.private_key !== 'string' || !serviceAccount.private_key.includes('BEGIN PRIVATE KEY')) {
        return unavailable('firebase_service_account_invalid');
      }
    } else if (!tokenEndpoint) {
      return unavailable('firebase_service_account_invalid');
    }
  } else if (!tokenEndpoint) {
    return unavailable('firebase_auth_token_provider_unconfigured');
  }

  return unavailable('firebase_cloud_unverified', true);
}
