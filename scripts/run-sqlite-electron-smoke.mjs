import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sqlite-electron-smoke.mjs');
const child = spawn(electronPath, [script], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
  windowsHide: true,
});

child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) console.error(`Electron smoke interrompu par ${signal}`);
  process.exitCode = code ?? 1;
});
