import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { JWT } from 'google-auth-library';
import { probeFirebaseCloudReadOnly } from '../src/diagnostics/firebase-cloud-proof.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

function resolveFromRoot(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT, raw);
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

function serviceAccountTokenProvider(serviceAccount) {
  const client = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/firebase.database',
      'https://www.googleapis.com/auth/devstorage.read_only',
    ],
  });
  return {
    async getAccessToken() {
      const result = await client.getAccessToken();
      return typeof result === 'string' ? result : result?.token;
    },
  };
}

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  const googleServicesPath = resolveFromRoot(process.env.MINA_GOOGLE_SERVICES)
    ?? path.join(ROOT, 'env', 'google-services.json');
  const serviceAccountPath = resolveFromRoot(process.env.MINA_FIREBASE_SERVICE_ACCOUNT)
    ?? path.join(ROOT, 'env', 'mina-vision-firebase-admin.json');

  let googleServices;
  try {
    googleServices = await readJson(googleServicesPath);
  } catch {
    console.log(JSON.stringify({ ready: false, configured: false, reason: 'firebase_google_services_unavailable' }, null, 2));
    process.exitCode = 1;
    return;
  }

  let serviceAccount;
  try {
    serviceAccount = await readJson(serviceAccountPath);
  } catch {
    console.log(JSON.stringify({ ready: false, configured: false, reason: 'firebase_service_account_unavailable' }, null, 2));
    process.exitCode = 1;
    return;
  }

  if (serviceAccount.project_id !== projectId) {
    console.log(JSON.stringify({ ready: false, configured: true, reason: 'firebase_service_account_project_mismatch' }, null, 2));
    process.exitCode = 1;
    return;
  }

  const databaseUrl = googleServices?.project_info?.firebase_url;
  const result = await probeFirebaseCloudReadOnly({
    projectId,
    storageBucket,
    databaseUrl,
    tokenProvider: serviceAccountTokenProvider(serviceAccount),
  });

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ready ? 0 : 1;
}

main().catch((error) => {
  console.log(JSON.stringify({ ready: false, configured: true, reason: 'firebase_cloud_probe_failed', error: error?.code ?? error?.name ?? 'unknown' }, null, 2));
  process.exitCode = 1;
});
