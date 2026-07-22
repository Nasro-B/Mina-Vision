import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileReaderRegistry } from '../src/files/file-reader-registry.mjs';
import { createTextReader } from '../src/files/text-reader.mjs';

let root;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mina-reader-registry-'));
});

afterEach(async () => rm(root, { recursive: true, force: true }));

function allowPolicy() {
  return { authorize: vi.fn(async ({ path }) => path) };
}

describe('file reader registry', () => {
  it('reads and redacts bounded UTF-8 text into grounded chunks', async () => {
    const path = join(root, 'notes.txt');
    await writeFile(path, 'Bonjour\ntoken="super-secret"\nFin', 'utf8');
    const registry = createFileReaderRegistry({
      policy: allowPolicy(),
      textReader: createTextReader({ chunkChars: 12 }),
    });

    const result = await registry.read({
      path,
      purpose: 'résumer le fichier',
      maxBytes: 1_024,
      sessionId: 'session-1',
    });

    expect(result.text).toContain('token="[REDACTED]"');
    expect(result.text).not.toContain('super-secret');
    expect(result.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks[0]).toEqual(expect.objectContaining({
      sourceOffsetStart: 0,
      contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    }));
  });

  it('decodes BOM-marked UTF-16LE text without treating it as binary', async () => {
    const path = join(root, 'unicode.txt');
    const body = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Salut Mina Vision', 'utf16le')]);
    await writeFile(path, body);
    const registry = createFileReaderRegistry({ policy: allowPolicy() });

    const result = await registry.read({ path, purpose: 'read', maxBytes: 1_024, sessionId: 'session-1' });

    expect(result.encoding).toBe('utf-16le');
    expect(result.text).toBe('Salut Mina Vision');
  });

  it.each([
    ['binary.txt', Buffer.from([65, 0, 66]), 100, 'binary_file_forbidden'],
    ['archive.zip', Buffer.from('PK fixture'), 100, 'unsupported_file_extension'],
    ['large.txt', Buffer.from('123456'), 5, 'file_too_large'],
  ])('rejects unsafe input %s', async (name, content, maxBytes, error) => {
    const path = join(root, name);
    await writeFile(path, content);
    const registry = createFileReaderRegistry({ policy: allowPolicy() });

    await expect(registry.read({ path, purpose: 'read', maxBytes, sessionId: 'session-1' }))
      .rejects.toThrow(error);
  });

  it('routes documents to a separate reader and propagates cancellation', async () => {
    const path = join(root, 'manual.pdf');
    await writeFile(path, '%PDF fixture', 'utf8');
    const documentReader = { read: vi.fn(async () => ({ format: 'pdf', text: 'contenu', chunks: [] })) };
    const registry = createFileReaderRegistry({ policy: allowPolicy(), documentReader });

    await expect(registry.read({ path, purpose: 'read', maxBytes: 100, sessionId: 'session-1' }))
      .resolves.toMatchObject({ format: 'pdf' });
    expect(documentReader.read).toHaveBeenCalledWith(expect.objectContaining({ path, maxBytes: 100 }));

    const controller = new AbortController();
    controller.abort();
    await expect(registry.read({
      path,
      purpose: 'read',
      maxBytes: 100,
      sessionId: 'session-1',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
