function unavailable(reason, configured = true, details = {}) {
  return Object.freeze({ ready: false, configured, reason, ...details });
}

function sanitizeStatus(status) {
  return Number.isInteger(status) ? status : 'network';
}

function normalizeHttpsUrl(value) {
  const url = new URL(String(value ?? '').trim());
  if (url.protocol !== 'https:') throw new Error('firebase_database_url_invalid');
  url.pathname = url.pathname.replace(/\/+$/u, '');
  url.search = '';
  url.hash = '';
  return url;
}

function requestSignal(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return { signal: undefined, cancel: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const { signal, cancel } = requestSignal(timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal });
  } finally {
    cancel();
  }
}

function storageProof(metadata, expectedBucket) {
  if (!metadata || typeof metadata !== 'object') return unavailable('firebase_storage_metadata_invalid');
  if (metadata.name !== expectedBucket) return unavailable('firebase_storage_bucket_mismatch');
  return Object.freeze({
    ready: true,
    bucket: expectedBucket,
    location: typeof metadata.location === 'string' ? metadata.location : null,
    storageClass: typeof metadata.storageClass === 'string' ? metadata.storageClass : null,
  });
}

export async function probeFirebaseCloudReadOnly({
  projectId,
  storageBucket,
  databaseUrl,
  tokenProvider,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
} = {}) {
  const normalizedProjectId = String(projectId ?? '').trim();
  const normalizedStorageBucket = String(storageBucket ?? '').trim();
  const normalizedDatabaseUrl = String(databaseUrl ?? '').trim();
  if (!normalizedProjectId || !normalizedStorageBucket || !normalizedDatabaseUrl) {
    return unavailable('firebase_cloud_config_missing', false);
  }
  if (!tokenProvider || typeof tokenProvider.getAccessToken !== 'function') {
    throw new TypeError('firebase_cloud_token_provider_required');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('firebase_cloud_fetch_required');

  let database;
  try {
    database = normalizeHttpsUrl(normalizedDatabaseUrl);
  } catch {
    return unavailable('firebase_database_url_invalid');
  }

  let token;
  try {
    token = await tokenProvider.getAccessToken();
  } catch {
    return unavailable('firebase_cloud_token_unavailable');
  }
  if (typeof token !== 'string' || !token.trim()) return unavailable('firebase_cloud_token_unavailable');

  const headers = { Authorization: `Bearer ${token.trim()}` };
  const storageUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(normalizedStorageBucket)}?fields=name,location,storageClass`;
  let storageResponse;
  try {
    storageResponse = await fetchWithTimeout(fetchImpl, storageUrl, { method: 'GET', headers }, timeoutMs);
  } catch (error) {
    return unavailable(`firebase_storage_cloud_unverified:${sanitizeStatus(error?.status)}`);
  }
  if (!storageResponse?.ok) {
    return unavailable(`firebase_storage_cloud_unverified:${sanitizeStatus(storageResponse?.status)}`);
  }

  let metadata;
  try {
    metadata = await storageResponse.json();
  } catch {
    return unavailable('firebase_storage_metadata_invalid');
  }
  const storage = storageProof(metadata, normalizedStorageBucket);
  if (!storage.ready) return storage;

  const databasePath = database.pathname === '/' ? '' : database.pathname;
  const rtdbUrl = `${database.origin}${databasePath}/.json?print=silent&timeout=3s`;
  let rtdbResponse;
  try {
    rtdbResponse = await fetchWithTimeout(fetchImpl, rtdbUrl, { method: 'GET', headers }, timeoutMs);
  } catch (error) {
    return unavailable(`firebase_rtdb_cloud_unverified:${sanitizeStatus(error?.status)}`, true, { storage });
  }
  if (!rtdbResponse?.ok) {
    return unavailable(`firebase_rtdb_cloud_unverified:${sanitizeStatus(rtdbResponse?.status)}`, true, { storage });
  }

  return Object.freeze({
    ready: true,
    configured: true,
    projectId: normalizedProjectId,
    storage,
    rtdb: Object.freeze({
      ready: true,
      host: database.host,
      status: rtdbResponse.status,
    }),
  });
}
