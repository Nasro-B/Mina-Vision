import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { prepareMinaElectronRuntime } from './prepare-electron-runtime.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function resolveScriptLaunch({ rootDir = ROOT_DIR, script, args = [] } = {}) {
  if (typeof script !== 'string' || script.trim().length < 1) {
    throw new TypeError('electron_script_required');
  }
  return Object.freeze({
    scriptPath: path.resolve(rootDir, script),
    args: Object.freeze(args.map((arg) => String(arg))),
  });
}

export async function runElectronScript({ rootDir = ROOT_DIR, script, args = process.argv.slice(3) } = {}) {
  const launch = resolveScriptLaunch({ rootDir, script, args });
  const runtime = await prepareMinaElectronRuntime({ rootDir });
  const child = spawn(runtime.exe, [launch.scriptPath, ...launch.args], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
    windowsHide: false,
  });

  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) resolve({ code: 1, signal });
      else resolve({ code: code ?? 0, signal: null });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const script = process.argv[2];
  runElectronScript({ script })
    .then(({ code }) => { process.exit(code); })
    .catch((error) => {
      console.error(String(error?.message ?? error));
      process.exit(1);
    });
}
