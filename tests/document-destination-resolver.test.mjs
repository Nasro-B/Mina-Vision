import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDocumentDestinationResolver } from '../src/documents/document-destination-resolver.mjs';

let root;
let sibling;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mina-document-destination-'));
  sibling = await mkdtemp(join(tmpdir(), 'mina-document-destination-sibling-'));
});

afterEach(async () => {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(sibling, { recursive: true, force: true }),
  ]);
});

describe('document destination resolver', () => {
  it('resolves a new file through its existing parent before authorizing it', async () => {
    const authorized = [];
    const resolver = createDocumentDestinationResolver({
      resolveExistingPath: realpath,
      authorizeDestination: async (target) => {
        authorized.push(target);
        return target;
      },
    });
    const requested = join(root, 'promoted.pdf');
    const expected = join(await realpath(root), 'promoted.pdf');

    await expect(resolver.resolveDestination(requested)).resolves.toBe(expected);
    expect(authorized).toEqual([expected]);
  });

  it('authorizes the canonical target after parent traversal is resolved', async () => {
    const authorized = [];
    const resolver = createDocumentDestinationResolver({
      resolveExistingPath: realpath,
      authorizeDestination: async (target) => {
        authorized.push(target);
        return target;
      },
    });
    const requested = join(root, '..', basename(sibling), 'promoted.pdf');
    const expected = join(await realpath(sibling), 'promoted.pdf');

    await expect(resolver.resolveDestination(requested)).resolves.toBe(expected);
    expect(authorized).toEqual([expected]);
  });

  it('refuses a relative output path before any authorization', async () => {
    const resolver = createDocumentDestinationResolver({
      resolveExistingPath: realpath,
      authorizeDestination: async () => {
        throw new Error('should_not_authorize');
      },
    });

    await expect(resolver.resolveDestination('relative.pdf')).rejects.toThrow('document_destination_absolute_path_required');
  });

  it('refuses an UNC output path before any authorization', async () => {
    const resolver = createDocumentDestinationResolver({
      resolveExistingPath: realpath,
      authorizeDestination: async () => {
        throw new Error('should_not_authorize');
      },
    });

    await expect(resolver.resolveDestination('\\\\server\\share\\promoted.pdf')).rejects.toThrow('document_destination_absolute_path_required');
  });

  it('rejects an authorization response that changes the canonical target', async () => {
    const resolver = createDocumentDestinationResolver({
      resolveExistingPath: realpath,
      authorizeDestination: async () => join(root, 'redirected.pdf'),
    });

    await expect(resolver.resolveDestination(join(root, 'promoted.pdf'))).rejects.toThrow('document_destination_authorization_mismatch');
  });
});
