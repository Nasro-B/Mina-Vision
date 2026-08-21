import { describe, expect, it, vi } from 'vitest';
import { composeResearch } from '../src/code/research/compose-research.mjs';
import { createPackageRegistry } from '../src/code/research/package-registry.mjs';
import { createKnowledgeCache } from '../src/code/research/knowledge-cache.mjs';
import { createDocFetcher } from '../src/code/research/doc-fetcher.mjs';

const NPM = { 'dist-tags': { latest: '5.2.0' }, versions: { '5.2.0': { license: 'MIT' } } };

function build({ fetchJson } = {}) {
  const registry = createPackageRegistry({ fetchJson: fetchJson ?? vi.fn(async () => NPM) });
  const docFetcher = createDocFetcher({ fetchText: async () => '<h1>Doc</h1>' });
  const cache = createKnowledgeCache({ ttlMs: 10 * 60_000 });
  return { research: composeResearch({ registry, docFetcher, cache }), cache };
}

describe('compose-research (recherche T2.4)', () => {
  it('exige registry + docFetcher + cache', () => {
    expect(() => composeResearch({ registry: {}, docFetcher: {}, cache: {} })).toThrow('dependencies_required');
  });

  it('packageVersion : miss → registre + mémorisé ; 2e appel → servi du cache', async () => {
    const fetchJson = vi.fn(async () => NPM);
    const { research, cache } = build({ fetchJson });
    const first = await research.packageVersion('fastify');
    expect(first).toMatchObject({ latest: '5.2.0', fromCache: false });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const second = await research.packageVersion('fastify');
    expect(second).toMatchObject({ latest: '5.2.0', fromCache: true });
    expect(fetchJson).toHaveBeenCalledTimes(1); // pas de 2e appel réseau
    // et c'est mémorisé avec provenance → explain cite la source
    expect(cache.explain('npm:fastify')).toMatch(/5\.2\.0.*npmjs/u);
  });

  it('doc : délègue au doc-fetcher (évidence non fiable)', async () => {
    const { research } = build();
    const doc = await research.doc('https://fastify.dev/docs/');
    expect(doc).toMatchObject({ trust: 'untrusted' });
    expect(doc.evidence).toContain('Doc');
  });

  it('explain : honnête quand rien n’est appris', () => {
    const { research } = build();
    expect(research.explain('npm:inconnu')).toMatch(/je dois le vérifier/u);
  });
});
