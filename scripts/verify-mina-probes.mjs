import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { composeHomeDomain } from '../src/home/compose-home-domain.mjs';
import { createRuntimeManifest } from '../src/sandbox/runtime-manifest.mjs';
import { createDefaultWindowsSandboxProbes } from '../src/sandbox/windows-sandbox.mjs';
import { resolveStorageRoots } from '../src/system/storage-roots.mjs';

const GOOGLE_OAUTH_CLIENT_CONFIG_SECRET = 'google/oauth/client-config';
const MAIL_ACCOUNT_PREFIX = 'mail/account/';
const SAFE_HOME_REASON = /^[a-z][a-z0-9_:-]{0,199}$/u;

function safeHomeReason(raw) {
  const base = String(raw ?? '').split(':')[0].trim().toLocaleLowerCase('fr-FR');
  if (SAFE_HOME_REASON.test(base)) return base;
  if (!base) return 'home_not_configured';
  return 'home_not_configured';
}

function unique(value) {
  return [...new Set(value.filter(Boolean))];
}

export function resolveMailUserDataDirs({
  appData = process.env.APPDATA ?? '',
  explicitDir,
} = {}) {
  return unique([
    typeof explicitDir === 'string' && explicitDir.trim() ? path.resolve(explicitDir) : null,
    appData ? path.join(appData, 'Mina Vision') : null,
    appData ? path.join(appData, 'agentvisionsourire') : null,
  ]);
}

export function resolveGoogleHomeSdkPath({ env = process.env } = {}) {
  const explicitPath = env.MINA_GOOGLE_HOME_SDK_PATH?.trim();
  if (explicitPath) return path.resolve(explicitPath);
  const userProfile = env.USERPROFILE?.trim();
  if (!userProfile) return null;
  return path.join(userProfile, '.mina', 'sdk', 'google-home', '1.9');
}

function mailOAuthDetails({ googleClientConfig, firebaseProjectId } = {}) {
  const oauthProjectId = googleClientConfig?.projectId?.trim();
  const targetFirebaseProjectId = firebaseProjectId?.trim();
  if (!oauthProjectId) return {};
  return {
    oauthProjectId,
    ...(targetFirebaseProjectId ? {
      firebaseProjectId: targetFirebaseProjectId,
      oauthProjectMatchesFirebase: oauthProjectId === targetFirebaseProjectId,
    } : {}),
  };
}

async function readJsonFile(filename, read = readFile) {
  try {
    const raw = await read(filename, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function probeMailAccounts({
  userDataDirs = resolveMailUserDataDirs(),
  readFileImpl = readFile,
  googleClientConfig,
  firebaseProjectId,
} = {}) {
  if (!Array.isArray(userDataDirs)) throw new TypeError('mail_probe_user_data_dirs_invalid');
  const oauthDetails = mailOAuthDetails({ googleClientConfig, firebaseProjectId });

  let lastReason = 'mail_keyring_missing';
  for (const userDataDir of userDataDirs) {
    if (typeof userDataDir !== 'string' || !userDataDir.trim()) continue;
    const record = await readJsonFile(path.join(userDataDir, 'mina-keyring.json'), readFileImpl);
    if (!record) {
      lastReason = 'mail_keyring_missing';
      continue;
    }
    const secrets = record?.secrets;
    if (!secrets || typeof secrets !== 'object') {
      return { ready: false, reason: 'google_oauth_client_config_missing' };
    }
    const hasClientConfig = Object.hasOwn(secrets, GOOGLE_OAUTH_CLIENT_CONFIG_SECRET);
    if (!hasClientConfig) return { ready: false, reason: 'google_oauth_client_config_missing' };
    const hasMailAccount = Object.keys(secrets).some((key) => key.startsWith(MAIL_ACCOUNT_PREFIX));
    if (!hasMailAccount) return { ready: false, reason: 'mail_account_missing', ...oauthDetails };
    return { ready: true, ...oauthDetails };
  }

  return { ready: false, reason: lastReason };
}

export async function probeGoogleHomeSdk({
  env = process.env,
  readFileImpl = readFile,
} = {}) {
  const sdkPath = resolveGoogleHomeSdkPath({ env });
  if (!sdkPath) return { ready: false, reason: 'google_home_sdk_unavailable' };
  const manifestPath = path.join(sdkPath, 'manifest.json');
  try {
    await readFileImpl(manifestPath, 'utf8');
    return { ready: true, expectedPath: sdkPath, manifestPath };
  } catch {
    return { ready: false, reason: 'google_home_sdk_unavailable', expectedPath: sdkPath, manifestPath };
  }
}

export async function probeWindowsSandbox({
  env = process.env,
  platform = process.platform,
  userDataPath,
  sandboxExecutable = 'C:\\Windows\\System32\\WindowsSandbox.exe',
  probes,
  runPowerShell,
} = {}) {
  if (platform !== 'win32') return { ready: false, reason: 'windows_required' };

  const resolvedUserData = userDataPath?.trim?.()
    || env.MINA_USERDATA_PATH?.trim?.()
    || (env.APPDATA?.trim?.() ? path.join(env.APPDATA.trim(), 'Mina Vision') : null);
  if (!resolvedUserData) return { ready: false, reason: 'sandbox_user_data_unavailable' };

  const roots = resolveStorageRoots({ userDataPath: resolvedUserData, env });
  const manifestPath = path.join(roots.sandboxRuntimeRoot, 'runtime-manifest.json');
  const runtimeManifest = createRuntimeManifest({ manifestPath, runtimeRoot: roots.sandboxRuntimeRoot });
  const activeProbes = probes ?? createDefaultWindowsSandboxProbes({
    sandboxExecutable,
    workspaceRoot: roots.sandboxRoot,
    runtimeManifest,
    ...(runPowerShell ? { runPowerShell } : {}),
  });

  const checks = [];
  for (const [probe, reason] of [
    ['feature', 'windows_sandbox_feature_disabled'],
    ['executable', 'windows_sandbox_executable_missing'],
    ['virtualization', 'virtualization_unavailable'],
    ['ntfs', 'sandbox_workspace_not_ntfs'],
    ['runtimes', 'sandbox_runtimes_unavailable'],
  ]) {
    try {
      const passed = await activeProbes[probe]();
      checks.push({ name: probe, ready: passed === true });
      if (passed !== true) {
        const output = { ready: false, reason, checks, sandboxRoot: roots.sandboxRoot, sandboxRuntimeRoot: roots.sandboxRuntimeRoot };
        if (probe === 'runtimes') {
          const runtimeCheck = await runtimeManifest.verify();
          output.runtimeReason = runtimeCheck.reason;
          output.manifestPath = manifestPath;
        }
        return output;
      }
    } catch {
      return { ready: false, reason: `sandbox_probe_failed:${probe}`, checks, sandboxRoot: roots.sandboxRoot, sandboxRuntimeRoot: roots.sandboxRuntimeRoot };
    }
  }

  return { ready: true, checks, sandboxRoot: roots.sandboxRoot, sandboxRuntimeRoot: roots.sandboxRuntimeRoot, manifestPath };
}

export function probeHomeDomain({ env = process.env } = {}) {
  const domain = composeHomeDomain({ env });
  const details = {
    homeAssistantBaseUrlConfigured: Boolean(env.HOME_ASSISTANT_BASE_URL?.trim()),
    homeAssistantAuthConfigured: Boolean(env.HOME_ASSISTANT_TOKEN?.trim()),
    mqttBrokerConfigured: Boolean(env.MQTT_BROKER_URL?.trim()),
  };
  if (domain.state === 'configured') {
    return { ready: true, connectors: Object.keys(domain.connectors), ...details };
  }
  return { ready: false, reason: safeHomeReason(domain.reason ?? 'home_not_configured'), ...details };
}
