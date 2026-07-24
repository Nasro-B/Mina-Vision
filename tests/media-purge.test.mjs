import { describe, it, expect } from 'vitest';
import { createMediaPurge } from '../src/chat/media-purge.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_784_800_000_000;

function harness({ files = {}, statError = [], rmError = [] } = {}) {
  const removed = [];
  const logs = [];
  const purge = createMediaPurge({
    directory: 'C:/data/chat-media',
    readdir: async () => Object.keys(files),
    stat: async (path) => {
      const name = path.split('/').pop();
      if (statError.includes(name)) throw new Error('stat_impossible');
      return { mtimeMs: files[name] };
    },
    rm: async (path) => {
      const name = path.split('/').pop();
      if (rmError.includes(name)) throw new Error('verrou');
      removed.push(name);
    },
    clock: () => NOW,
    logger: { append: (entry) => logs.push(entry) },
  });
  return { purge, removed, logs };
}

describe('createMediaPurge', () => {
  it('supprime les .media de plus de 14 jours, garde les récents, journalise', async () => {
    const { purge, removed, logs } = harness({
      files: {
        'vieux.media': NOW - 15 * DAY,
        'recent.media': NOW - 2 * DAY,
        'limite.media': NOW - 13 * DAY,
      },
    });
    const bilan = await purge.run();
    expect(removed).toEqual(['vieux.media']);
    expect(bilan).toEqual({ scanned: 3, purged: 1, kept: 2 });
    expect(logs.some((entry) => entry.event === 'chat_media_purge' && entry.file === 'vieux.media')).toBe(true);
    expect(logs.some((entry) => entry.event === 'chat_media_purge_bilan')).toBe(true);
  });

  it("ne touche JAMAIS un autre suffixe ni un chemin avec séparateur", async () => {
    const { purge, removed } = harness({
      files: {
        'secret.txt': NOW - 100 * DAY,
        'archive.zip': NOW - 100 * DAY,
        '../evasion.media': NOW - 100 * DAY,
      },
    });
    const bilan = await purge.run();
    expect(removed).toEqual([]);
    expect(bilan.scanned).toBe(0);
  });

  it('au doute (stat impossible) on GARDE ; échec de rm journalisé sans crash', async () => {
    const { purge, removed, logs } = harness({
      files: { 'douteux.media': NOW - 30 * DAY, 'verrouille.media': NOW - 30 * DAY },
      statError: ['douteux.media'],
      rmError: ['verrouille.media'],
    });
    const bilan = await purge.run();
    expect(removed).toEqual([]);
    expect(bilan).toEqual({ scanned: 2, purged: 0, kept: 2 });
    expect(logs.some((entry) => entry.event === 'chat_media_purge_echec')).toBe(true);
  });

  it('répertoire absent : bilan vide, aucun crash', async () => {
    const purge = createMediaPurge({
      directory: 'C:/absent', readdir: async () => { throw new Error('ENOENT'); },
      stat: async () => ({}), rm: async () => {}, clock: () => NOW,
    });
    expect(await purge.run()).toEqual({ scanned: 0, purged: 0, kept: 0 });
  });

  it('borne plancher : jamais un maxAge sous 24 h (une purge agressive serait une perte)', async () => {
    const { purge, removed } = (function build() {
      const removedInner = [];
      const instance = createMediaPurge({
        directory: 'C:/d', readdir: async () => ['frais.media'],
        stat: async () => ({ mtimeMs: NOW - 2 * 60 * 60 * 1000 }), // 2 h
        rm: async (path) => removedInner.push(path),
        maxAgeMs: 1_000, // demande absurde => remontée à 24 h
        clock: () => NOW,
      });
      return { purge: instance, removed: removedInner };
    }());
    await purge.run();
    expect(removed).toEqual([]);
  });
});
