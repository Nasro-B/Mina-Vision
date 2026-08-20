// Reinitialize the Mina Vision local memory vault after an unrecoverable DPAPI/keyring loss.
//
// This script is intentionally conservative:
// - requires --yes;
// - targets only the named Electron userData folder;
// - archives old encrypted files by rename, never deletes them;
// - writes the new recovery phrase to a local file, never to stdout.

import { app, safeStorage } from 'electron';
import { constants } from 'node:fs';
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { createKeyringFileStorage } from '../src/crypto/keyring-file-storage.mjs';
import { createKeyring } from '../src/crypto/keyring.mjs';

const probeOnly = process.argv.includes('--probe');
const confirmed = process.argv.includes('--yes');

if (!confirmed && !probeOnly) {
  console.error('reinitialize-memory-vault: pass --probe to inspect or --yes to archive and reinitialize the active vault.');
  app.exit(2);
}

const appData = process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming');
const userData = path.join(appData, 'Mina Vision');

app.setName('Mina Vision');
app.setPath('userData', userData);

function timestamp() {
  return new Date().toISOString().replace(/[-:T.]/gu, '').slice(0, 14);
}

const archiveSuffix = `.archive-reset-${timestamp()}`;
const userDataRoot = path.resolve(userData);

function assertInsideUserData(target) {
  const resolved = path.resolve(target);
  if (resolved !== userDataRoot && !resolved.startsWith(`${userDataRoot}${path.sep}`)) {
    throw new Error(`target_outside_userData:${resolved}`);
  }
  return resolved;
}

async function exists(target) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function archivePath(target) {
  const source = assertInsideUserData(target);
  if (!(await exists(source))) return null;

  let destination = `${source}${archiveSuffix}`;
  let index = 1;
  while (await exists(destination)) {
    destination = `${source}${archiveSuffix}.${index}`;
    index += 1;
  }
  await rename(source, destination);
  return Object.freeze({ from: source, to: destination });
}

async function archiveMatchingFiles(directory, pattern) {
  const resolvedDirectory = assertInsideUserData(directory);
  const names = await readdir(resolvedDirectory).catch(() => []);
  const archived = [];
  for (const name of names) {
    if (!pattern.test(name)) continue;
    const result = await archivePath(path.join(resolvedDirectory, name));
    if (result) archived.push(result);
  }
  return archived;
}

async function archiveDirectoryIfNonEmpty(directory) {
  const resolvedDirectory = assertInsideUserData(directory);
  if (!(await exists(resolvedDirectory))) return null;
  if (!(await stat(resolvedDirectory)).isDirectory()) return null;
  const names = await readdir(resolvedDirectory).catch(() => []);
  if (names.length === 0) return null;
  return archivePath(resolvedDirectory);
}

async function main() {
  await app.whenReady();
  await mkdir(userData, { recursive: true });

  const keyringPath = path.join(userData, 'mina-keyring.json');
  if (probeOnly) {
    const record = JSON.parse(await readFile(keyringPath, 'utf8'));
    safeStorage.decryptString(Buffer.from(record.wrappedMasterKey, 'base64'));
    console.log(JSON.stringify({
      ok: true,
      state: 'healthy',
      userData,
      secretCount: record?.secrets ? Object.keys(record.secrets).length : 0,
      recordKeys: Object.keys(record).sort(),
    }, null, 2));
    return;
  }

  let oldSecretNames = [];
  try {
    const oldRecord = JSON.parse(await readFile(keyringPath, 'utf8'));
    oldSecretNames = oldRecord?.secrets ? Object.keys(oldRecord.secrets).sort() : [];
  } catch {
    oldSecretNames = [];
  }

  const archived = [];
  for (const filename of [
    'mina-keyring.json',
    'mina-keyring.json.rotation',
    'mina-memory.sqlite',
    'mina-memory.sqlite-wal',
    'mina-memory.sqlite-shm',
    'chat-pc-identity.json',
    'mina-lessons.enc',
  ]) {
    const result = await archivePath(path.join(userData, filename));
    if (result) archived.push(result);
  }

  archived.push(
    ...await archiveMatchingFiles(path.join(userData, 'logs'), /^journal-sensible-\d{4}-\d{2}-\d{2}\.jsonl$/u),
  );

  for (const directory of ['chat-media', 'emergency']) {
    const result = await archiveDirectoryIfNonEmpty(path.join(userData, directory));
    if (result) archived.push(result);
  }

  const keyring = createKeyring({
    storage: createKeyringFileStorage({ filename: keyringPath }),
    safeStorage,
  });
  const initialized = await keyring.initialize();

  try {
    const phraseFile = path.join(
      homedir(),
      'Documents',
      'Mina Vision',
      `PHRASE-RECUPERATION-MINA-VISION-${timestamp()}.txt`,
    );
    await mkdir(path.dirname(phraseFile), { recursive: true });
    await writeFile(phraseFile, [
      'NOUVELLE PHRASE DE RECUPERATION - Mina Vision',
      `Generee le ${new Date().toLocaleString('fr-FR')}`,
      '',
      initialized.recoveryPhrase,
      '',
      'Cette phrase rouvre le coffre si le chiffrement Windows change.',
      'Ne pas la laisser en clair sur le PC apres l avoir notee dans un endroit sur.',
    ].join('\n'), { encoding: 'utf8', flag: 'wx' });

    const newRecord = JSON.parse(await readFile(keyringPath, 'utf8'));
    safeStorage.decryptString(Buffer.from(newRecord.wrappedMasterKey, 'base64'));

    console.log(JSON.stringify({
      ok: true,
      userData,
      archived,
      oldSecretCount: oldSecretNames.length,
      oldSecretNames,
      phraseFile,
      newRecordKeys: Object.keys(newRecord).sort(),
    }, null, 2));
  } finally {
    initialized.masterKey.fill(0);
  }
}

main()
  .catch((error) => {
    console.error(`reinitialize-memory-vault: ${String(error?.message ?? error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    app.exit(process.exitCode ?? 0);
  });
