import { describe, expect, it } from 'vitest';
import { composeCapabilityCatalog } from '../src/core/capability-catalog.mjs';
import { composeOperationalBudgets } from '../src/core/operational-budgets.mjs';
import { createVersionedJsonStore } from '../src/core/versioned-json-store.mjs';

describe('capability catalog (amélioration A)', () => {
  it('sépare readiness, health et capabilities depuis le snapshot réel', () => {
    const catalog = composeCapabilityCatalog({
      memoryUnlocked: true,
      phone: { connected: false },
      sandbox: { available: false, reason: 'virtualization_unavailable' },
      skills: ['mythos'],
      bundledSkills: ['superpowers'],
      mail: { implemented: true, configured: false },
      googleTasks: { operational: true },
    });
    expect(catalog.readiness).toMatchObject({ memoryUnlocked: true, phoneConnected: false, sandboxAvailable: false });
    expect(catalog.health).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sandbox', level: 'unavailable' }),
      expect.objectContaining({ id: 'phone', level: 'disconnected' }),
      expect.objectContaining({ id: 'mail', level: 'not_configured' }),
    ]));
    expect(catalog.health.find((issue) => issue.id === 'googleTasks')).toBeUndefined();
    expect(catalog.health.find((issue) => issue.id === 'memory')).toBeUndefined();
    expect(catalog.capabilities.skills).toEqual(['mythos']);
    expect(catalog.capabilities.permanent.length).toBeGreaterThan(5);
  });

  it('un snapshot vide produit un catalogue honnête, jamais optimiste', () => {
    const catalog = composeCapabilityCatalog({});
    expect(catalog.readiness.memoryUnlocked).toBe(false);
    expect(catalog.health).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'memory', level: 'locked' }),
    ]));
    expect(catalog.capabilities.skills).toEqual([]);
  });
});

describe('operational budgets (amélioration D)', () => {
  it('valide et gèle les bornes, défauts sur toute valeur invalide', () => {
    const budgets = composeOperationalBudgets({
      mission: { maxActions: 25, timeoutMs: -5 },
      journal: { retentionDays: 'abc' },
    });
    expect(budgets.mission).toEqual({ maxActions: 25, timeoutMs: 900_000 });
    expect(budgets.journal.retentionDays).toBe(7);
    expect(budgets.archives.maxExpansionRatio).toBe(100);
    expect(Object.isFrozen(budgets.mission)).toBe(true);
  });
});

describe('versioned json store (amélioration C)', () => {
  function harness(initial = {}) {
    const files = new Map(Object.entries(initial));
    return {
      files,
      readFile: async (name) => {
        if (!files.has(name)) throw new Error('ENOENT');
        return files.get(name);
      },
      writeFile: async (name, data) => files.set(name, data),
      rename: async (from, to) => {
        files.set(to, files.get(from));
        files.delete(from);
      },
    };
  }

  it('save/load au schéma courant, absent → défauts', async () => {
    const fs = harness();
    const store = createVersionedJsonStore({ filename: 's.json', schemaVersion: 1, ...fs, now: () => 0 });
    await expect(store.load({ defaults: { a: 1 } })).resolves.toMatchObject({ data: { a: 1 }, status: 'absent' });
    await store.save({ endpoint: '192.168.1.2:5555' });
    await expect(store.load()).resolves.toMatchObject({ data: { endpoint: '192.168.1.2:5555' }, status: 'loaded' });
  });

  it('version inconnue → quarantaine .perdu-, JAMAIS interprétée ni écrasée', async () => {
    const fs = harness({ 's.json': JSON.stringify({ schemaVersion: 99, data: { future: true } }) });
    const store = createVersionedJsonStore({
      filename: 's.json', schemaVersion: 1, ...fs, now: () => Date.parse('2026-07-22T10:00:00Z'),
    });
    const result = await store.load({ defaults: null });
    expect(result).toMatchObject({ status: 'unknown_version_quarantined', foundVersion: 99, data: null });
    expect(fs.files.has('s.json.perdu-2026-07-22')).toBe(true);
    expect(fs.files.has('s.json')).toBe(false);
  });

  it('fichier legacy sans version → migrateur déclaré ; JSON corrompu → quarantaine', async () => {
    const legacy = harness({ 's.json': JSON.stringify({ version: 1, endpoint: '10.0.0.2:5555' }) });
    const store = createVersionedJsonStore({
      filename: 's.json', schemaVersion: 1, ...legacy, now: () => 0,
      migrateLegacy: (raw) => ({ endpoint: raw.endpoint }),
    });
    await expect(store.load()).resolves.toMatchObject({ status: 'migrated_legacy', data: { endpoint: '10.0.0.2:5555' } });

    const corrupt = harness({ 'c.json': '{pas du json' });
    const corruptStore = createVersionedJsonStore({ filename: 'c.json', schemaVersion: 1, ...corrupt, now: () => 0 });
    await expect(corruptStore.load({ defaults: { a: 1 } })).resolves.toMatchObject({ status: 'corrupt_quarantined', data: { a: 1 } });
  });
});
