import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeExclusiveFile } from '../src/files/exclusive-file-writer.mjs';

let directory;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-exclusive-writer-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('exclusive file writer', () => {
  it('creates the target with wx and 0600 instead of overwriting through a later rename', async () => {
    const writeFileImpl = vi.fn(async () => {});
    await writeExclusiveFile({
      path: join(directory, 'export.pdf'),
      content: Buffer.from('PDF bytes'),
      encoding: null,
      writeFileImpl,
    });

    expect(writeFileImpl).toHaveBeenCalledWith(
      join(directory, 'export.pdf'),
      Buffer.from('PDF bytes'),
      { encoding: undefined, flag: 'wx', mode: 0o600 },
    );
  });

  it('preserves an existing destination file', async () => {
    const target = join(directory, 'export.pdf');
    await writeFile(target, 'original', { flag: 'wx' });

    await expect(writeExclusiveFile({
      path: target,
      content: Buffer.from('new content'),
      encoding: null,
    })).rejects.toThrow();
    await expect(readFile(target, 'utf8')).resolves.toBe('original');
  });
});
