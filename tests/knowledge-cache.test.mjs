import { describe, expect, it } from 'vitest';
import { createKnowledgeCache } from '../src/code/research/knowledge-cache.mjs';

describe('knowledge-cache (recherche T2.3)', () => {
  it('remember puis recall dans le TTL → valeur + source + date', () => {
    const kc = createKnowledgeCache({ now: () => 1_000, ttlMs: 10_000 });
    kc.remember('fastify@latest', { value: '5.2.0', source: 'https://registry.npmjs.org/fastify' });
    expect(kc.recall('fastify@latest')).toMatchObject({ value: '5.2.0', source: expect.stringContaining('npmjs') });
  });

  it('provenance OBLIGATOIRE : sans source → refus (jamais un fait sans origine)', () => {
    const kc = createKnowledgeCache();
    expect(() => kc.remember('x', { value: '1.0' })).toThrow('source_required');
    expect(() => kc.remember('x', { source: 'https://a' })).toThrow('value_required');
  });

  it('EXPIRE : au-delà du TTL, recall → null (jamais présenté comme éternel)', () => {
    let t = 0;
    const kc = createKnowledgeCache({ now: () => t, ttlMs: 5_000 });
    kc.remember('k', { value: 'v', source: 'https://s' });
    t = 4_999;
    expect(kc.recall('k')).not.toBeNull();
    t = 5_000;
    expect(kc.recall('k')).toBeNull();
  });

  it('explain : honnête sur cache vide/expiré (« je dois le vérifier »)', () => {
    const kc = createKnowledgeCache();
    expect(kc.explain('inconnu')).toMatch(/je dois le vérifier/u);
    kc.remember('react@latest', { value: '19.0.0', source: 'https://registry.npmjs.org/react' });
    expect(kc.explain('react@latest')).toMatch(/19\.0\.0.*Source.*npmjs/u);
  });
});
