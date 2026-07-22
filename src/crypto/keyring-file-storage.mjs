import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

async function readJson(filename) {
  try {
    const text = await readFile(filename, 'utf8');
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('keyring_record_too_large');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(filename, value) {
  await mkdir(dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export function createKeyringFileStorage({ filename } = {}) {
  if (!filename) throw new TypeError('keyring_filename_required');
  const rotation = `${filename}.rotation`;
  return Object.freeze({
    read: () => readJson(filename),
    writeAtomic: (value) => writeJsonAtomic(filename, value),
    readRotation: () => readJson(rotation),
    writeRotationAtomic: (value) => writeJsonAtomic(rotation, value),
    clearRotation: () => rm(rotation, { force: true }),
  });
}
