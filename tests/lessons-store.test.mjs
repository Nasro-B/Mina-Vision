import { describe, expect, it, vi } from 'vitest';
import { createLessonsStore } from '../src/core/lessons-store.mjs';
import { createLessonsRegistry, composeLessonsBrief } from '../src/core/lessons-registry.mjs';

function memoryFs() {
  const files = new Map();
  return {
    files,
    readFile: vi.fn(async (p) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p); }),
    writeFile: vi.fn(async (p, data) => { files.set(p, data); }),
    rename: vi.fn(async (from, to) => { files.set(to, files.get(from)); files.delete(from); }),
  };
}

describe('lessons store — encrypted vault persistence (L4)', () => {
  it('round-trips the registry through encryption', async () => {
    const key = Buffer.alloc(32, 9);
    const fs = memoryFs();
    const store = createLessonsStore({ filePath: 'C:/x/lessons.enc', key, ...fs, now: () => 1 });

    const reg = createLessonsRegistry({ now: () => 1000 });
    reg.learnFromFailure({ scope: 'provider', code: 'gemini_timeout' });
    await store.save(reg.serialize());

    // Le fichier sur disque ne contient PAS le texte en clair.
    const onDisk = fs.files.get('C:/x/lessons.enc');
    expect(onDisk).not.toContain('gemini_timeout');
    expect(onDisk).toContain('ciphertext');

    const restored = createLessonsRegistry({ now: () => 2000 });
    expect(restored.hydrate(await store.load())).toBe(true);
    expect(restored.preflight('provider:gemini_timeout')).toMatchObject({ signature: 'provider:gemini_timeout' });
  });

  it('load returns null on a missing or tampered file (never crashes)', async () => {
    const fs = memoryFs();
    const store = createLessonsStore({ filePath: 'C:/x/lessons.enc', key: Buffer.alloc(32, 1), ...fs });
    expect(await store.load()).toBeNull(); // absent

    fs.files.set('C:/x/lessons.enc', JSON.stringify({ version: 1, nonce: 'AAAA', ciphertext: 'AAAA', authTag: 'AAAA' }));
    expect(await store.load()).toBeNull(); // altéré → null, pas d'exception
  });

  it('a wrong key cannot read another key\'s blob', async () => {
    const fs = memoryFs();
    const good = createLessonsStore({ filePath: 'C:/x/l.enc', key: Buffer.alloc(32, 7), ...fs });
    const reg = createLessonsRegistry();
    reg.learnFromFailure({ scope: 'sms', code: 'quiet_hours' });
    await good.save(reg.serialize());

    const wrong = createLessonsStore({ filePath: 'C:/x/l.enc', key: Buffer.alloc(32, 8), ...fs });
    expect(await wrong.load()).toBeNull();
  });

  it('rejects a non-32-byte key', () => {
    const fs = memoryFs();
    expect(() => createLessonsStore({ filePath: 'x', key: Buffer.alloc(16), ...fs })).toThrow('lessons_store_key_invalid');
  });
});

describe('lessons brief — injectable warnings, bounded, never authorizes', () => {
  it('renders the most recurrent active lessons and nothing when none active', () => {
    const reg = createLessonsRegistry({ now: () => 1 });
    expect(composeLessonsBrief(reg.list())).toBe('');
    reg.learnFromFailure({ scope: 'provider', code: 'gemini_timeout' });
    reg.learnFromFailure({ scope: 'provider', code: 'gemini_timeout' }); // 2 occurrences
    reg.learnFromFailure({ scope: 'sms', code: 'quiet_hours' });
    const brief = composeLessonsBrief(reg.list(), { max: 2 });
    expect(brief).toMatch(/^Leçons à respecter :/u);
    expect(brief.indexOf('gemini')).toBeLessThan(brief.indexOf('quiet') === -1 ? Infinity : brief.indexOf('quiet')); // récurrente d'abord
  });
});
