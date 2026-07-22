import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { rebuild } from '@electron/rebuild';
import { resolveNativeCacheRoot } from './native-cache-paths.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BINDING_PATH = path.join(
  ROOT_DIR,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node',
);

await access(BINDING_PATH);
const cacheRoot = await resolveNativeCacheRoot({ rootDir: ROOT_DIR });
const nodeBinding = path.join(cacheRoot, `node-v${process.versions.modules}`, 'better_sqlite3.node');
const electronModules = process.env.npm_config_target_modules || '148';
const electronBinding = path.join(cacheRoot, `electron-v${electronModules}`, 'better_sqlite3.node');
await mkdir(path.dirname(nodeBinding), { recursive: true });
await mkdir(path.dirname(electronBinding), { recursive: true });
await copyFile(BINDING_PATH, nodeBinding);

let electronBuildReady = false;
try {
  await rebuild({
    buildPath: ROOT_DIR,
    electronVersion: '43.1.0',
    force: true,
    onlyModules: ['better-sqlite3'],
  });
  await copyFile(BINDING_PATH, electronBinding);
  electronBuildReady = true;
} finally {
  await copyFile(nodeBinding, BINDING_PATH);
}

if (!electronBuildReady) throw new Error('electron_native_rebuild_failed');
console.log(JSON.stringify({
  cacheRoot,
  node: { abi: process.versions.modules, binding: nodeBinding },
  electron: { abi: electronModules, binding: electronBinding },
}));
