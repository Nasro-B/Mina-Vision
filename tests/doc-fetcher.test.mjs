import { describe, expect, it, vi } from 'vitest';
import { createDocFetcher } from '../src/code/research/doc-fetcher.mjs';

const HTML = '<html><head><style>.x{}</style></head><body><script>alert(1)</script><h1>Fastify</h1><p>listen({ port })</p></body></html>';

describe('doc-fetcher (recherche T2.2)', () => {
  it('exige fetchText', () => {
    expect(() => createDocFetcher({ fetchText: null })).toThrow('fetch_required');
  });

  it('doc officielle allowlistée → texte extrait + marqué « Source non fiable »', async () => {
    const fetchText = vi.fn(async () => HTML);
    const df = createDocFetcher({ fetchText, now: () => Date.parse('2026-08-21T10:00:00Z') });
    const doc = await df.fetchDoc('https://fastify.dev/docs/latest/');
    expect(doc.evidence).toContain('Fastify');
    expect(doc.evidence).toContain('listen({ port })');
    expect(doc.evidence).not.toContain('alert'); // script retiré
    expect(doc).toMatchObject({ trust: 'untrusted', source: 'https://fastify.dev/docs/latest/' });
    expect(doc.label).toMatch(/non fiable/u);
  });

  it('host HORS allowlist → refus net (jamais de fetch)', async () => {
    const fetchText = vi.fn(async () => HTML);
    const df = createDocFetcher({ fetchText });
    await expect(df.fetchDoc('https://evil.example/doc')).rejects.toThrow('host_not_allowed');
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('isAllowed : officiel OK (+ sous-domaine), tiers KO', () => {
    const df = createDocFetcher({ fetchText: async () => '' });
    expect(df.isAllowed('https://developer.mozilla.org/fr/docs/Web')).toBe(true);
    expect(df.isAllowed('https://api.nodejs.org/x')).toBe(true); // sous-domaine
    expect(df.isAllowed('https://nodejs.org.evil.com/x')).toBe(false); // pas un vrai sous-domaine
    expect(df.isAllowed('https://random.io/x')).toBe(false);
  });

  it('passe par url-policy (SSRF) avant fetch', async () => {
    const urlPolicy = { authorize: vi.fn(async () => {}) };
    const df = createDocFetcher({ fetchText: async () => HTML, urlPolicy });
    await df.fetchDoc('https://docs.python.org/3/library/');
    expect(urlPolicy.authorize).toHaveBeenCalledWith('https://docs.python.org/3/library/');
  });
});
