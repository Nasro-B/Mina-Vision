import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const GOOGLE_SIGN_IN_URL = 'https://accounts.google.com/ServiceLogin?service=mail';

function defaultChromeCandidates(env = process.env) {
  return [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
}

export function createBrowserProfileAuthenticator({
  profileDir,
  chromeCandidates = defaultChromeCandidates(),
  exists = existsSync,
  spawnProcess = spawn,
} = {}) {
  if (typeof profileDir !== 'string' || !path.isAbsolute(profileDir)
    || !Array.isArray(chromeCandidates) || typeof exists !== 'function' || typeof spawnProcess !== 'function') {
    throw new TypeError('browser_profile_auth_dependencies_required');
  }

  const openGoogleSignIn = async () => {
    const executable = chromeCandidates.find((candidate) => exists(candidate));
    if (!executable) throw new Error('chrome_executable_not_found');
    const child = spawnProcess(executable, [
      `--user-data-dir=${path.resolve(profileDir)}`,
      '--profile-directory=Default',
      GOOGLE_SIGN_IN_URL,
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return Object.freeze({ launched: true, pid: child.pid ?? null, profileDir: path.resolve(profileDir) });
  };

  return Object.freeze({ openGoogleSignIn });
}
