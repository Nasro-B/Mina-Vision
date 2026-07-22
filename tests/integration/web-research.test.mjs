import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { createWebReader } from '../../src/research/web-reader.mjs';

const fixtureUrl = new URL('../fixtures/web-research-page.html', import.meta.url);

describe('structured web research integration', () => {
  it('extracts DOM, accessibility, same-origin iframe, styles and redacted public JSON', async () => {
    const html = await readFile(fixtureUrl);
    const server = createServer((request, response) => {
      if (request.url === '/robots.txt') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('User-agent: *\nDisallow: /blocked\n');
        return;
      }
      if (request.url === '/frame') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Frame</title><p>Texte du cadre local</p>');
        return;
      }
      if (request.url?.startsWith('/api/public')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok', token: 'JSON_SECRET' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    const reader = createWebReader({ page, clock: () => Date.parse('2026-07-15T00:00:00.000Z') });

    try {
      const result = await reader.read({
        url: `http://127.0.0.1:${port}/`,
        operation: 'index',
        indexingAuthorized: true,
        selectors: ['main', 'input[type=password]'],
        styleRequests: [{ selector: '.answer', properties: ['color', 'font-weight'] }],
      });

      expect(result).toEqual(expect.objectContaining({
        title: 'Recherche Mina Vision',
        rawStored: false,
        finalUrl: `http://127.0.0.1:${port}/`,
      }));
      expect(result.visibleText).toContain('Contenu dynamique chargé');
      expect(result.frames[0].visibleText).toContain('Texte du cadre local');
      expect(result.accessibility).toContain('Recette de gâteau');
      expect(result.computedStyles[0].values).toEqual({ color: 'rgb(12, 34, 56)', 'font-weight': '700' });
      expect(result.jsonLd[0]).toEqual({ '@type': 'Article', name: 'Preuve locale' });
      expect(JSON.stringify(result)).not.toContain('PASSWORD_SECRET');
      expect(JSON.stringify(result)).not.toContain('INLINE_SECRET');
      expect(JSON.stringify(result)).not.toContain('NETWORK_SECRET');
      expect(JSON.stringify(result)).not.toContain('JSON_SECRET');
      expect(JSON.stringify(result)).toContain('[REDACTED]');
      expect(result.evidence.length).toBeGreaterThan(2);
      expect(result.evidence.every((item) => item.method === 'structured_extraction')).toBe(true);

      await expect(reader.read({
        url: `http://127.0.0.1:${port}/blocked`, operation: 'index', indexingAuthorized: true,
      })).rejects.toThrow('robots_disallow_indexing');
    } finally {
      await browser.close();
      server.close();
    }
  }, 60_000);
});
