import { existsSync } from 'node:fs';
import { access, copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { rcedit } from 'rcedit';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_USER_MODEL_ID = 'fr.sourireconcept.minavision';

export function resolveRuntimePaths({ rootDir = ROOT_DIR } = {}) {
  const electronDist = path.join(rootDir, 'node_modules', 'electron', 'dist');
  return Object.freeze({
    sourceExe: path.join(electronDist, 'electron.exe'),
    targetExe: path.join(electronDist, 'Mina Vision.exe'),
    stamp: path.join(electronDist, 'Mina Vision.exe.mina-runtime.json'),
    icon: path.join(rootDir, 'assets', 'Logo', 'mina-vision.ico'),
    packageJson: path.join(rootDir, 'package.json'),
  });
}

async function statSignature(file) {
  const info = await stat(file);
  return { size: info.size, mtimeMs: Math.trunc(info.mtimeMs) };
}

async function readStamp(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

async function readVersion(packageJson) {
  try {
    const pkg = JSON.parse(await readFile(packageJson, 'utf8'));
    return String(pkg.version ?? '1.0.0');
  } catch {
    return '1.0.0';
  }
}

function sameSignature(left, right) {
  return Boolean(left && right && left.size === right.size && left.mtimeMs === right.mtimeMs);
}

export async function prepareMinaElectronRuntime({ rootDir = ROOT_DIR, platform = process.platform } = {}) {
  const paths = resolveRuntimePaths({ rootDir });
  if (platform !== 'win32') {
    return { ok: true, exe: paths.sourceExe, reason: 'windows_only_runtime_identity' };
  }

  await access(paths.sourceExe);
  await access(paths.icon);

  const version = await readVersion(paths.packageJson);
  const source = await statSignature(paths.sourceExe);
  const icon = await statSignature(paths.icon);
  const stamp = await readStamp(paths.stamp);
  if (
    existsSync(paths.targetExe)
    && stamp?.version === version
    && stamp?.appUserModelId === APP_USER_MODEL_ID
    && sameSignature(stamp.source, source)
    && sameSignature(stamp.icon, icon)
  ) {
    return { ok: true, exe: paths.targetExe, cached: true };
  }

  await copyFile(paths.sourceExe, paths.targetExe);
  await rcedit(paths.targetExe, {
    icon: paths.icon,
    'version-string': {
      CompanyName: 'Sourire Concept',
      FileDescription: 'Mina Vision',
      InternalName: 'Mina Vision',
      OriginalFilename: 'Mina Vision.exe',
      ProductName: 'Mina Vision',
    },
    'file-version': version,
    'product-version': version,
    'requested-execution-level': 'asInvoker',
  });
  await writeFile(paths.stamp, JSON.stringify({
    version,
    appUserModelId: APP_USER_MODEL_ID,
    source,
    icon,
    preparedAt: new Date().toISOString(),
  }, null, 2), 'utf8');

  return { ok: true, exe: paths.targetExe, cached: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareMinaElectronRuntime()
    .then((result) => { console.log(JSON.stringify(result)); })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
      process.exit(1);
    });
}
