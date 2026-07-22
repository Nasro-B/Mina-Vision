import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createSensitiveJournalStore } from '../src/diagnostics/sensitive-journal-store.mjs';
import { sanitizeJournalPayload } from '../src/diagnostics/activity-journal.mjs';

function memoryFs() {
  const files = new Map();
  return {
    files,
    appendFile: async (name, data) => files.set(name, (files.get(name) ?? '') + data),
    readFile: async (name) => {
      if (!files.has(name)) throw new Error('ENOENT');
      return files.get(name);
    },
    readdir: async () => [...files.keys()].map((name) => name.split('/').pop()),
    rm: async (name) => files.delete(name),
    mkdir: async () => {},
  };
}

const KEY = randomBytes(32);
const NOW = Date.parse('2026-07-22T10:00:00.000Z');

describe('sanitizeJournalPayload (Task 5)', () => {
  it('remplace les champs texte par charCount + digest, y compris imbriqués', () => {
    const { sanitized, sensitiveText, digest } = sanitizeJournalPayload('voice_voice_transcript', {
      text: 'phrase privée unique', providerId: 'local', isFinal: true,
    });
    expect(sensitiveText).toBe('phrase privée unique');
    expect(sanitized).toMatchObject({ providerId: 'local', isFinal: true, charCount: 20 });
    expect(sanitized.text).toBeUndefined();
    expect(sanitized.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(digest).toBe(sanitized.digest);

    const nested = sanitizeJournalPayload('event', { payload: { utterance: 'stop mina', level: 2 } });
    expect(nested.sensitiveText).toBe('stop mina');
    expect(nested.sanitized.payload.utterance).toBeUndefined();
    expect(nested.sanitized.payload.level).toBe(2);
  });

  it('laisse intact un payload sans texte sensible', () => {
    const { sanitized, sensitiveText } = sanitizeJournalPayload('boot', { version: 'dev', goal: 'ouvrir le navigateur' });
    expect(sensitiveText).toBeNull();
    expect(sanitized).toEqual({ version: 'dev', goal: 'ouvrir le navigateur' });
  });
});

describe('sensitive journal store (couche 2)', () => {
  it('n\'écrit JAMAIS de texte en clair : chiffré après déverrouillage, tamponné avant', async () => {
    const fs = memoryFs();
    const store = createSensitiveJournalStore({ directory: 'vault', ...fs, now: () => NOW });

    store.store({ at: NOW, kind: 'voice_voice_transcript', digest: 'sha256:aa', text: 'phrase confidentielle' });
    expect([...fs.files.values()].join('')).toBe('');
    expect(store.isUnlocked()).toBe(false);

    const { flushed } = store.enableEncryption(KEY);
    expect(flushed).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const raw = [...fs.files.values()].join('');
    expect(raw).not.toContain('phrase confidentielle');
    expect(raw).toContain('sha256:aa');

    const texts = await store.read({ digests: ['sha256:aa'] });
    expect(texts.get('sha256:aa')).toBe('phrase confidentielle');
  });

  it('borne le tampon verrouillé et compte les pertes plutôt que de gonfler la RAM', () => {
    const fs = memoryFs();
    const store = createSensitiveJournalStore({ directory: 'vault', ...fs, now: () => NOW });
    for (let index = 0; index < 250; index += 1) {
      store.store({ at: NOW, kind: 'k', digest: `sha256:${index}`, text: `t${index}` });
    }
    const { flushed, dropped } = store.enableEncryption(KEY);
    expect(flushed).toBe(200);
    expect(dropped).toBe(50);
  });

  it('refuse une clé invalide et purge selon la rétention', async () => {
    const fs = memoryFs();
    const store = createSensitiveJournalStore({ directory: 'vault', ...fs, now: () => NOW });
    expect(() => store.enableEncryption(Buffer.alloc(16))).toThrow('sensitive_journal_key_invalid');

    fs.files.set('vault/journal-sensible-2026-07-01.jsonl', '{}\n');
    fs.files.set(`vault/journal-sensible-${new Date(NOW).toISOString().slice(0, 10)}.jsonl`, '{}\n');
    const { removed } = await store.purge();
    expect(removed).toBe(1);
  });

  it('read retourne une Map vide tant que la clé est absente', async () => {
    const fs = memoryFs();
    const store = createSensitiveJournalStore({ directory: 'vault', ...fs, now: () => NOW });
    expect((await store.read({ digests: ['sha256:aa'] })).size).toBe(0);
  });
});
