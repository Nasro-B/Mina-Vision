import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFilePolicy } from '../src/research/file-policy.mjs';
import { createFileReader } from '../src/research/file-reader.mjs';

let root;
let outside;
const cleanup = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mina-files-root-'));
  outside = await mkdtemp(join(tmpdir(), 'mina-files-outside-'));
  cleanup.push(root, outside);
});

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function reader(options = {}) {
  const policy = await createFilePolicy({ approvedRoots: [root] });
  return createFileReader({ policy, ...options });
}

describe('local file policy and reader', () => {
  it('reads approved text with canonical provenance and a digest', async () => {
    const path = join(root, 'notes.md');
    await writeFile(path, 'Bonjour Mina Vision\nDeuxième ligne', 'utf8');

    const result = await (await reader()).read({ path, operation: 'index' });

    expect(result).toEqual(expect.objectContaining({
      path,
      format: 'markdown',
      text: 'Bonjour Mina Vision\nDeuxième ligne',
      method: 'utf8_text',
      lineStart: 1,
      lineEnd: 2,
    }));
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects traversal and a symlink that escapes an approved root', async () => {
    const secret = join(outside, 'secret.txt');
    const link = join(root, 'escape.txt');
    await writeFile(secret, 'outside', 'utf8');
    await symlink(secret, link, 'file');
    const value = await reader();

    await expect(value.read({ path: join(root, '..', basename(outside), 'secret.txt'), operation: 'index' }))
      .rejects.toThrow('file_outside_approved_roots');
    await expect(value.read({ path: link, operation: 'index' }))
      .rejects.toThrow('file_outside_approved_roots');
  });

  it('allows an outside one-shot read only after explicit confirmation', async () => {
    const path = join(outside, 'manual.txt');
    await writeFile(path, 'lecture confirmée', 'utf8');
    const value = await reader();

    await expect(value.read({ path, operation: 'read' })).rejects.toThrow('file_confirmation_required');
    expect((await value.read({ path, operation: 'read', confirmed: true })).text).toBe('lecture confirmée');
    await expect(value.read({ path, operation: 'index', confirmed: true })).rejects.toThrow('file_outside_approved_roots');
  });

  it.each([
    ['.env', 'SECRET=x', 'sensitive_file_forbidden'],
    ['large.txt', '12345678901', 'file_too_large'],
    ['binary.txt', Buffer.from([65, 0, 66]), 'binary_file_forbidden'],
    ['unknown.zzz', 'plain text', 'unsupported_file_extension'],
  ])('rejects unsafe input %s', async (name, content, error) => {
    const path = join(root, name);
    await writeFile(path, content);
    const value = await reader({ maxFileBytes: 10 });
    await expect(value.read({ path, operation: 'index' })).rejects.toThrow(error);
  });

  it('rejects a file modified while it is being read', async () => {
    const path = join(root, 'changing.txt');
    const policy = { authorize: vi.fn(async () => path) };
    const stats = [
      { isFile: () => true, size: 4, mtimeMs: 1 },
      { isFile: () => true, size: 5, mtimeMs: 2 },
    ];
    const fileSystem = {
      stat: vi.fn(async () => stats.shift()),
      readFile: vi.fn(async () => Buffer.from('test')),
    };
    const value = createFileReader({ policy, fileSystem });

    await expect(value.read({ path, operation: 'index' })).rejects.toThrow('file_changed_during_read');
  });

  it('uses a separate bounded adapter for textual PDF extraction', async () => {
    const path = join(root, 'document.pdf');
    await writeFile(path, Buffer.from('%PDF fixture'));
    const pdfExtractor = vi.fn(async () => ({ text: 'Page une', pages: 1 }));

    const result = await (await reader({ pdfExtractor })).read({ path, operation: 'index' });

    expect(result).toEqual(expect.objectContaining({ format: 'pdf', text: 'Page une', pages: 1, method: 'pdf_text_adapter' }));
    expect(pdfExtractor).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ maxPages: 2_000 }));
  });
});
