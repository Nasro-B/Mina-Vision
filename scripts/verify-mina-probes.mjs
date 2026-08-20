import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { composeHomeDomain } from '../src/home/compose-home-domain.mjs';

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
} = {}) {
  if (!Array.isArray(userDataDirs)) throw new TypeError('mail_probe_user_data_dirs_invalid');

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
    if (!hasMailAccount) return { ready: false, reason: 'mail_account_missing' };
    return { ready: true };
  }

  return { ready: false, reason: lastReason };
}

export async function probeGoogleHomeSdk({
  env = process.env,
  readFileImpl = readFile,
} = {}) {
  const sdkPath = resolveGoogleHomeSdkPath({ env });
  if (!sdkPath) return { ready: false, reason: 'google_home_sdk_unavailable' };
  try {
    await readFileImpl(path.join(sdkPath, 'manifest.json'), 'utf8');
    return { ready: true };
  } catch {
    return { ready: false, reason: 'google_home_sdk_unavailable' };
  }
}

export function probeHomeDomain({ env = process.env } = {}) {
  const domain = composeHomeDomain({ env });
  if (domain.state === 'configured') return { ready: true };
  return { ready: false, reason: safeHomeReason(domain.reason ?? 'home_not_configured') };
}
