import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryServices } from '../src/memory/composition.mjs';

const cleanups = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe('Mina Vision memory composition', () => {
  it('opens the encrypted local repositories and creates line-addressable file research', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mina-composition-'));
    cleanups.push(root);
    const document = join(root, 'note.txt');
    await writeFile(document, 'Mina Vision se souvient.', 'utf8');

    const services = await createMemoryServices({
      masterKey: Buffer.alloc(32, 23),
      databasePath: join(root, 'memory.sqlite'),
      approvedRoots: [root],
      getWebPage: async () => { throw new Error('not_used'); },
      securePermissions: () => {},
    });
    services.memoryService.remember({
      kind: 'local_owner', value: 'owner', channel: 'local', content: 'Rendez-vous mardi',
    });

    expect(services.memoryService.recall({ kind: 'local_owner', value: 'owner', query: 'mardi' })[0].content)
      .toBe('Rendez-vous mardi');
    expect((await services.researchService.readFile({ path: document })).evidence[0])
      .toMatchObject({ locator: `${document}:1-1`, extract: 'Mina Vision se souvient.' });
    expect(services.semanticMode).toBe('lexical_degraded');
    services.close();
  });

  it('indexes and recalls memories semantically through the supplied local embedder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mina-semantic-composition-'));
    cleanups.push(root);
    const embedder = {
      embed: async (text) => Float32Array.from(String(text).includes('dessert') ? [1, 0] : [1, 0]),
    };
    const services = await createMemoryServices({
      masterKey: Buffer.alloc(32, 29),
      databasePath: join(root, 'memory.sqlite'),
      approvedRoots: [root],
      getWebPage: async () => { throw new Error('not_used'); },
      securePermissions: () => {},
      embedder,
    });
    try {
      services.memoryService.remember({
        kind: 'local_owner', value: 'owner', channel: 'sms', content: 'Recette de gâteau au chocolat',
      });

      const recalled = await services.memoryService.recallSemantic({
        kind: 'local_owner', value: 'owner', query: 'dessert',
      });

      expect(recalled[0]).toMatchObject({ content: 'Recette de gâteau au chocolat' });
      expect(recalled[0].score).toBeGreaterThan(0);
      expect(services.semanticMode).toBe('semantic_local');
    } finally {
      services.close();
    }
  });

  it('backfills more than 128 existing memories in bounded embedding batches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mina-semantic-batches-'));
    cleanups.push(root);
    const batchSizes = [];
    const embedder = {
      embedMany: async (texts) => {
        if (texts.length > 128) throw new Error('batch_too_large');
        batchSizes.push(texts.length);
        return texts.map(() => Float32Array.from([1, 0]));
      },
      embed: async () => Float32Array.from([1, 0]),
    };
    const services = await createMemoryServices({
      masterKey: Buffer.alloc(32, 30), databasePath: join(root, 'memory.sqlite'), approvedRoots: [root],
      getWebPage: async () => { throw new Error('not_used'); }, securePermissions: () => {}, embedder,
    });
    try {
      for (let index = 0; index < 129; index += 1) {
        services.memoryService.remember({
          eventId: `memory-${index}`, kind: 'local_owner', value: 'owner', channel: 'local', content: `Souvenir ${index}`,
        });
      }
      await services.memoryService.recallSemantic({ kind: 'local_owner', value: 'owner', query: 'souvenir' });
      expect(batchSizes).toEqual([128, 1]);
    } finally {
      services.close();
    }
  });
});
