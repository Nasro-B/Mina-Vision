import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createHealthService } from '../src/diagnostics/health-service.mjs';
import { capabilityFromReadiness } from '../src/diagnostics/capability-readiness.mjs';
import { probeLmStudio } from '../src/diagnostics/lm-studio-health.mjs';
import { loadConfig } from '../src/config.mjs';
import { parseAuthorizedAdbTransports } from '../src/devices/adb-devices.mjs';

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
    const sdkPath = path.join(process.env.USERPROFILE ?? '', '.mina', 'sdk', 'google-home', '1.9');
    try {
      await readFile(path.join(sdkPath, 'manifest.json'), 'utf8');
      return { ready: true };
    } catch {
      return { ready: false, reason: 'google_home_sdk_unavailable' };
    }
  },
  mailAccounts: async () => ({ ready: false, reason: 'mail_accounts_not_yet_configurable_from_cli' }),
  firebase: async () => ({
    ready: Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_STORAGE_BUCKET),
    optional: true,
    reason: process.env.FIREBASE_PROJECT_ID ? undefined : 'firebase_unconfigured',
  }),
};

function capabilitiesFromHealth(report) {
  return Object.freeze({
    'models.lm_studio': capabilityFromReadiness({ id: 'models.lm_studio', implemented: true, probe: report.lmStudio }),
    'computer_use.android': capabilityFromReadiness({ id: 'computer_use.android', implemented: true, probe: report.androidTransport }),
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
