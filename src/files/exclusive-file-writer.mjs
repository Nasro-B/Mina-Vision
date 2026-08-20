import { writeFile } from 'node:fs/promises';

export async function writeExclusiveFile({
  path,
  content,
  encoding = null,
  writeFileImpl = writeFile,
} = {}) {
  if (typeof path !== 'string' || path.length === 0) throw new TypeError('exclusive_file_path_required');
  await writeFileImpl(path, content, { encoding: encoding ?? undefined, flag: 'wx', mode: 0o600 });
  return Object.freeze({
    bytes: Buffer.isBuffer(content) ? content.length : Buffer.byteLength(String(content), encoding ?? undefined),
  });
}
