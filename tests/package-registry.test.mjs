import { describe, expect, it, vi } from 'vitest';
import { createPackageRegistry } from '../src/code/research/package-registry.mjs';

// Réponse registry npm figée (forme réelle : dist-tags + versions).
const FASTIFY_RESPONSE = {
  'dist-tags': { latest: '5.2.0' },
  versions: { '5.2.0': { license: 'MIT' } },
};

describe('package-registry (recherche T2.1)', () => {
  it('exige fetchJson', () => {
    expect(() => createPackageRegistry({ fetchJson: null })).toThrow('fetch_required');
  });

  it('renvoie { fait, source, date } et jamais un chiffre nu ; describe CITE la source', async () => {
    const fetchJson = vi.fn(async () => FASTIFY_RESPONSE);
    const reg = createPackageRegistry({ fetchJson, now: () => Date.parse('2026-08-21T10:00:00Z') });
    const result = await reg.npmPackage('fastify');
    expect(result).toMatchObject({ name: 'fastify', latest: '5.2.0', license: 'MIT', registry: 'npm' });
    expect(result.source).toContain('registry.npmjs.org');
    expect(result.date).toBe('2026-08-21T10:00:00.000Z');
    expect(reg.describe(result)).toMatch(/5\.2\.0.*Source.*registry\.npmjs\.org.*2026-08-21/u);
  });

  it('cache daté : 2e appel dans le TTL → aucun 2e fetch ; après expiration → refetch', async () => {
    let t = 1_000;
    const fetchJson = vi.fn(async () => FASTIFY_RESPONSE);
    const reg = createPackageRegistry({ fetchJson, now: () => t, ttlMs: 10_000 });
    await reg.npmPackage('fastify');
    await reg.npmPackage('fastify');
    expect(fetchJson).toHaveBeenCalledTimes(1); // servi par le cache
    t += 20_000; // au-delà du TTL
    await reg.npmPackage('fastify');
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('passe par url-policy (SSRF) avant de fetcher', async () => {
    const urlPolicy = { authorize: vi.fn(async () => {}) };
    const reg = createPackageRegistry({ fetchJson: async () => FASTIFY_RESPONSE, urlPolicy });
    await reg.npmPackage('react');
    expect(urlPolicy.authorize).toHaveBeenCalledWith(expect.stringContaining('registry.npmjs.org/react'));
  });

  it('refuse un nom de paquet invalide (anti-injection URL)', async () => {
    const reg = createPackageRegistry({ fetchJson: async () => ({}) });
    await expect(reg.npmPackage('../../etc/passwd')).rejects.toThrow('package_name_invalid');
    await expect(reg.npmPackage('a b; rm -rf')).rejects.toThrow('package_name_invalid');
  });

  it('paquet sans réponse → describe honnête (version inconnue)', async () => {
    const reg = createPackageRegistry({ fetchJson: async () => ({}) });
    const result = await reg.npmPackage('inexistant-xyz');
    expect(result.latest).toBeNull();
    expect(reg.describe(result)).toMatch(/inconnue/u);
  });
});
