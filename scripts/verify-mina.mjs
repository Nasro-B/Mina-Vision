import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createHealthService } from '../src/diagnostics/health-service.mjs';
import { capabilityFromReadiness } from '../src/diagnostics/capability-readiness.mjs';
import { probeFirebaseBackupConfiguration } from '../src/diagnostics/firebase-health.mjs';
import { probeLmStudio } from '../src/diagnostics/lm-studio-health.mjs';
import { loadConfig } from '../src/config.mjs';
import { parseAuthorizedAdbTransports } from '../src/devices/adb-devices.mjs';
import { loadGoogleClientConfigFromEnvDir } from '../src/mail/oauth/google-client-config-file.mjs';
import { probeGoogleHomeSdk, probeMailAccounts, probeHomeDomain, resolveMailUserDataDirs } from './verify-mina-probes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
const config = loadConfig(process.env);

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 3_000 }, (error, stdout) => {
      resolve({ error, stdout: String(stdout ?? '') });
    });
  });
}

async function packageVersion() {
  const raw = await readFile(path.join(ROOT, 'package.json'), 'utf8');
  return JSON.parse(raw).version ?? 'unknown';
}

const probes = {
  cloudKeys: async () => {
    const ready = process.env.MINA_KEYS_ROTATED === 'true'
      && Boolean(process.env.GEMINI_API_KEY) && Boolean(process.env.OPENROUTER_API_KEY);
    return { ready, reason: ready ? undefined : 'keys_not_rotated_or_absent' };
  },
  lmStudio: async () => {
    if (!config.providers.lmStudio.enabled) return { ready: false, reason: 'lm_studio_disabled' };
    return probeLmStudio({ config: config.providers.lmStudio, timeoutMs: 3_000 });
  },
  androidTransport: async () => {
    const { error, stdout } = await run(process.env.ADB_PATH || 'adb', ['devices']);
    if (error) return { ready: false, reason: 'adb_unavailable' };
    const transports = parseAuthorizedAdbTransports(stdout);
    const authorized = transports.length > 0;
    return { ready: authorized, reason: authorized ? undefined : 'no_authorized_android_device', transports };
  },
  wifi: async () => {
    const { error, stdout } = await run(process.env.ADB_PATH || 'adb', ['devices']);
    const wifiConnected = !error && /:\d+\s+device\b/u.test(stdout);
    return { ready: wifiConnected, reason: wifiConnected ? undefined : 'wifi_transport_not_connected' };
  },
  googleHomeSdk: async () => {
    return probeGoogleHomeSdk({ env: process.env });
  },
  mailAccounts: async () => {
    const userDataDirs = resolveMailUserDataDirs();
    const googleClientConfig = loadGoogleClientConfigFromEnvDir(path.join(ROOT, 'env'), { readdirSync, readFileSync });
    return probeMailAccounts({
      userDataDirs,
      googleClientConfig,
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID?.trim(),
    });
  },
  home: async () => probeHomeDomain({ env: process.env }),
  firebase: async () => ({
    ...await probeFirebaseBackupConfiguration({
      projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET?.trim(),
      googleServicesPath: process.env.MINA_GOOGLE_SERVICES?.trim() || path.join(ROOT, 'env', 'google-services.json'),
      serviceAccountPath: process.env.MINA_FIREBASE_SERVICE_ACCOUNT?.trim()
        || path.join(ROOT, 'env', 'mina-vission-5355334a72f5.json'),
      tokenEndpoint: process.env.MINA_BACKUP_TOKEN_ENDPOINT?.trim() || null,
    }),
    optional: true,
  }),
};

function capabilitiesFromHealth(report) {
  return Object.freeze({
    'models.lm_studio': capabilityFromReadiness({ id: 'models.lm_studio', implemented: true, probe: report.lmStudio }),
    'computer_use.android': capabilityFromReadiness({ id: 'computer_use.android', implemented: true, probe: report.androidTransport }),
    'home': capabilityFromReadiness({ id: 'home', implemented: true, probe: report.home }),
    mail: capabilityFromReadiness({ id: 'mail', implemented: true, probe: report.mailAccounts }),
    'backup.firebase': capabilityFromReadiness({ id: 'backup.firebase', implemented: true, probe: report.firebase }),
  });
}

async function main() {
  const service = createHealthService({ probes });
  const report = await service.runOnce();
  const version = await packageVersion();
  const output = {
    minaVersion: version,
    nodeVersion: process.version,
    rootDir: ROOT,
    ...report,
    capabilities: capabilitiesFromHealth(report),
  };
  console.log(JSON.stringify(output, null, 2));
  process.exitCode = report.summary.allRequiredReady ? 0 : 0; // informational: readiness is reported, never fails the process by itself.
}

main();
