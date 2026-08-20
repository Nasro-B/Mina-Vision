import { describe, expect, it } from 'vitest';
import {
  BROWSER_COMMAND_TYPES, createBrowserActionResult, createBrowserPerformanceSpan,
  normalizeBrowserCommand, normalizeBrowserSnapshot, normalizeBrowserUrl,
} from '../src/browser/browser-contracts.mjs';

describe('browser-contracts : URL', () => {
  it('accepte http/https, rejette les autres schémas', () => {
    expect(normalizeBrowserUrl('https://example.com/a?b=c')).toBe('https://example.com/a?b=c');
    expect(() => normalizeBrowserUrl('javascript:alert(1)')).toThrow('browser_url_scheme_forbidden');
    expect(() => normalizeBrowserUrl('file:///etc/passwd')).toThrow('browser_url_scheme_forbidden');
    expect(() => normalizeBrowserUrl('pas une url')).toThrow('browser_url_invalid');
  });
});

describe('browser-contracts : BrowserCommand', () => {
  it('normalise une navigation valide', () => {
    const command = normalizeBrowserCommand({ commandId: 'c1', type: 'navigate', source: 'voice', targetUrl: 'https://wikipedia.org' });
    expect(command).toMatchObject({ commandId: 'c1', type: 'navigate', source: 'voice', targetUrl: 'https://wikipedia.org/' });
    expect(Object.isFrozen(command)).toBe(true);
  });

  it('exige un commandId (déduplication) et un type valide', () => {
    expect(() => normalizeBrowserCommand({ type: 'navigate' })).toThrow('browser_command_id_required');
    expect(() => normalizeBrowserCommand({ commandId: 'c', type: 'teleport' })).toThrow('browser_command_type_invalid');
    expect(BROWSER_COMMAND_TYPES).toContain('search');
  });

  it('exige une requête non vide pour une recherche', () => {
    expect(normalizeBrowserCommand({ commandId: 'c', type: 'search', query: 'dentifrice' }).query).toBe('dentifrice');
    expect(() => normalizeBrowserCommand({ commandId: 'c', type: 'search', query: '  ' })).toThrow('browser_command_query_required');
  });

  it('refuse une URL à schéma interdit dans une navigation', () => {
    expect(() => normalizeBrowserCommand({ commandId: 'c', type: 'navigate', targetUrl: 'file:///x' })).toThrow('browser_url_scheme_forbidden');
  });
});

describe('browser-contracts : BrowserSnapshot', () => {
  it('compact ne porte NI image NI DOM', () => {
    const snap = normalizeBrowserSnapshot({ pageId: 'p1', navigationId: 'n1', url: 'https://a.test/x', readyState: 'complete' }, 'compact');
    expect(snap.elements).toBeUndefined();
    expect(snap.imageBase64).toBeUndefined();
    expect(snap.origin).toBe('https://a.test');
  });

  it('semantic borne les éléments à 120, vision ajoute le digest', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ ref: `e${i}` }));
    expect(normalizeBrowserSnapshot({ pageId: 'p', navigationId: 'n', elements: many }, 'semantic').elements).toHaveLength(120);
    expect(normalizeBrowserSnapshot({ pageId: 'p', navigationId: 'n', imageDigest: 'abc' }, 'vision').imageDigest).toBe('abc');
  });
});

describe('browser-contracts : ActionResult', () => {
  it('attempted et verified restent distincts ; verified exige une raison', () => {
    expect(createBrowserActionResult({ commandId: 'c', attempted: true, verified: false }).verified).toBe(false);
    expect(() => createBrowserActionResult({ commandId: 'c', verified: true })).toThrow('browser_result_verification_reason_required');
    const ok = createBrowserActionResult({ commandId: 'c', attempted: true, verified: true, verificationReason: 'url_finale' });
    expect(ok).toMatchObject({ attempted: true, verified: true, verificationReason: 'url_finale' });
  });
});

describe('browser-contracts : PerformanceSpan', () => {
  it('ne fuit NI requête NI URL complète (origine seulement), garde les nombres', () => {
    const span = createBrowserPerformanceSpan({
      correlationId: 'x', commandId: 'c', route: 'fast', phase: 'goto',
      url: 'https://secret.test/path?token=ABC', durationMs: 120, payloadBytes: 42,
    });
    const serialized = JSON.stringify(span);
    expect(serialized).not.toContain('token=ABC');
    expect(serialized).not.toContain('/path');
    expect(span.origin).toBe('https://secret.test');
    expect(span.durationMs).toBe(120);
    expect(span.payloadBytes).toBe(42);
  });
});
