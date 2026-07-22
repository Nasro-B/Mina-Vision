import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

function validateFile(root, file) {
  let url;
  try {
    url = new URL(file?.url);
  } catch {
    throw new TypeError('model_source_url_invalid');
  }
  if (url.protocol !== 'https:') throw new TypeError('model_source_url_invalid');
  if (!file.path || isAbsolute(file.path) || !/^[a-f0-9]{64}$/u.test(file.sha256 ?? '')) {
    throw new TypeError('model_file_manifest_invalid');
  }
  const destination = resolve(root, file.path);
  const fromRoot = relative(root, destination);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('model_file_path_invalid');
  }
  return { url, destination };
}

export async function installModelManifest({
  manifest,
  fetchImpl = fetch,
  authorized = false,
  networkEnabled = false,
} = {}) {
  if (authorized !== true) throw new Error('model_install_authorization_required');
  if (networkEnabled !== true) throw new Error('model_install_network_disabled');
  if (!manifest?.id || !manifest.installPath || !manifest.revision
    || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new TypeError('model_manifest_invalid');
  }
  if (!manifest.license) throw new TypeError('model_manifest_license_required');
  const installPath = resolve(manifest.installPath);
  if (existsSync(installPath)) throw new Error('model_install_path_exists');
  const quarantineRoot = join(dirname(installPath), '.quarantine');
  const partialPath = join(quarantineRoot, randomUUID());
  await mkdir(partialPath, { recursive: true });
  try {
    for (const file of manifest.files) {
      const { url, destination } = validateFile(partialPath, file);
      await mkdir(dirname(destination), { recursive: true });
      const response = await fetchImpl(url, { redirect: 'error' });
      if (!response?.ok || !response.body) throw new Error(`model_download_failed:${response?.status ?? 'unknown'}`);
      const hash = createHash('sha256');
      const digestTap = new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), digestTap, createWriteStream(destination, { flags: 'wx' }));
      if (hash.digest('hex') !== file.sha256) throw new Error('model_digest_mismatch');
    }
    await rename(partialPath, installPath);
    await rm(quarantineRoot, { recursive: false, force: true }).catch(() => {});
    return Object.freeze({ id: manifest.id, installPath, files: manifest.files.length });
  } catch (error) {
    await rm(partialPath, { recursive: true, force: true });
    throw error;
  }
}
