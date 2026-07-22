import { createInterface } from 'node:readline';
import { execFile } from 'node:child_process';
import * as nut from '@nut-tree-fork/nut-js';
import { createDesktopDriver } from './desktop-driver.mjs';

const MAX_LINE_LENGTH = 1_000_000;

// Lancement d'application Windows par NOM (jamais un chemin ni des arguments — le normalizer
// l'a déjà garanti) : Start-Process résout apps du PATH, alias App Execution et apps Store.
// execFile sans shell + apostrophes doublées = zéro interpolation possible.
const launchApp = (app) => new Promise((resolve, reject) => {
  const safeName = String(app).replace(/'/gu, "''");
  execFile('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `Start-Process -FilePath '${safeName}'`,
  ], { windowsHide: true, timeout: 15_000 }, (error) => {
    if (error) reject(new Error(`Lancement impossible: ${String(error.message).slice(0, 200)}`));
    else resolve();
  });
});

// Observation optimisée pour le modèle : brut RGBA → JPEG largeur max 1280, qualité 80.
// Mesuré (1920×1080) : 351 Ko PNG/367 ms → 65 Ko/~110 ms — 5× moins d'upload par action.
const encodeObservation = async ({ width, height, data }) => {
  const { default: sharp } = await import('sharp');
  const jpeg = await sharp(data, { raw: { width, height, channels: 4 } })
    .resize({ width: Math.min(width, 1_280), withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { imageBase64: jpeg.toString('base64'), mimeType: 'image/jpeg' };
};

const driver = createDesktopDriver(nut, { launchApp, encodeObservation });

const respond = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const handle = async (request) => {
  if (!request?.id || typeof request.method !== 'string') {
    throw new Error('Requête worker invalide.');
  }

  switch (request.method) {
    case 'observe':
      return driver.observe();
    case 'execute':
      return driver.execute(request.params?.action);
    case 'release_all_inputs':
      return driver.releaseAllInputs();
    default:
      throw new Error(`Méthode worker interdite: ${request.method}`);
  }
};

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

lines.on('line', async (line) => {
  let request;
  try {
    if (line.length > MAX_LINE_LENGTH) throw new Error('Requête worker trop volumineuse.');
    request = JSON.parse(line);
    const result = await handle(request);
    respond({ id: request.id, ok: true, result });
  } catch (error) {
    respond({
      id: request?.id ?? null,
      ok: false,
      error: String(error?.message || error).slice(0, 300),
    });
  }
});

const shutdown = async () => {
  try {
    await driver.releaseAllInputs();
  } finally {
    process.exit(0);
  }
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
