import { describe, expect, it, vi } from 'vitest';
import {
  redactSensitiveText,
  redactSensitiveValue,
  redactTargetedHtml,
  sanitizePublicUrl,
} from '../src/research/network-evidence.mjs';
import { createResearchService } from '../src/research/research-service.mjs';
import { createWebReader } from '../src/research/web-reader.mjs';

describe('web reader url policy (R-07)', () => {
  const fakePage = (finalUrl) => ({
    goto: vi.fn(async () => {}),
    evaluate: vi.fn(async () => ({ title: '', visibleText: '' })),
    waitForLoadState: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    url: () => finalUrl,
    on: vi.fn(),
    off: vi.fn(),
  });

  it('refuse l\'URL demandée AVANT toute navigation quand la politique la rejette', async () => {
    const page = fakePage('http://127.0.0.1/');
    const urlPolicy = { authorize: vi.fn(async () => { throw new Error('private_network_forbidden'); }) };
    const reader = createWebReader({ page, urlPolicy });
    await expect(reader.read({ url: 'http://127.0.0.1:1234/admin' })).rejects.toThrow('private_network_forbidden');
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('profil light plafonne networkidle à 2,5 s ; défaut « full » reste à 30 s (SPEC-BROWSER-001 §5.6)', async () => {
    const light = fakePage('https://public.test/');
    await createWebReader({ page: light }).read({ url: 'https://public.test/', profile: 'light' }).catch(() => {});
    expect(light.waitForLoadState).toHaveBeenCalledWith('networkidle', { timeout: 2_500 });

    const full = fakePage('https://public.test/');
    await createWebReader({ page: full }).read({ url: 'https://public.test/' }).catch(() => {});
    expect(full.waitForLoadState).toHaveBeenCalledWith('networkidle', { timeout: 30_000 });
  });

  it('refuse une navigation publique qui aboutit sur une destination privée (redirection)', async () => {
    const page = fakePage('http://192.168.1.10/interne');
    const urlPolicy = {
      authorize: vi.fn(async (url) => {
        if (String(url).includes('192.168.')) throw new Error('private_network_forbidden');
        return { url, origin: new URL(url).origin, addresses: [] };
      }),
    };
    const reader = createWebReader({ page, urlPolicy });
    await expect(reader.read({ url: 'https://public.test/' })).rejects.toThrow('private_network_forbidden');
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(urlPolicy.authorize).toHaveBeenCalledTimes(2);
  });
});

describe('web evidence redaction', () => {
  it('redacts sensitive URL parameters, headers and nested JSON values', () => {
    expect(sanitizePublicUrl('https://example.test/path?token=abc&view=ok&password=secret'))
      .toBe('https://example.test/path?token=%5BREDACTED%5D&view=ok&password=%5BREDACTED%5D');
    expect(redactSensitiveValue({
      title: 'public',
      token: 'abc',
      nested: { Authorization: 'Bearer secret', value: 7 },
    })).toEqual({
      title: 'public',
      token: '[REDACTED]',
      nested: { Authorization: '[REDACTED]', value: 7 },
    });
  });

  it('redacts password accessibility text and sensitive URLs embedded in HTML or scripts', () => {
    expect(redactSensitiveText('- textbox "Mot de passe": PASSWORD_SECRET\n- link: /details?token=LINK_SECRET&view=ok'))
      .toBe('- textbox "Mot de passe": [REDACTED]\n- link: /details?token=[REDACTED]&view=ok');
    expect(redactTargetedHtml('<a href="/details?token=LINK_SECRET&amp;view=ok">Lien</a>'))
      .not.toContain('LINK_SECRET');
    expect(redactSensitiveText("fetch('/api?token=NETWORK_SECRET&view=ok')"))
      .toBe("fetch('/api?token=[REDACTED]&view=ok')");
  });
});

describe('research service', () => {
  it('returns only localized evidence from the selected reader', async () => {
    const expected = [{ sourceId: 'web-1', locator: 'https://example.test/#main' }];
    const service = createResearchService({
      fileReader: { read: async () => ({ evidence: [{ sourceId: 'file-1' }] }) },
      webReader: { read: async () => ({ evidence: expected, title: 'Test' }) },
    });

    await expect(service.readWeb({ url: 'https://example.test/' })).resolves.toEqual({
      evidence: expected,
      result: { title: 'Test' },
    });
  });

  it('turns a local file result into line-addressable evidence', async () => {
    const service = createResearchService({
      fileReader: { read: async () => ({
        path: 'C:\\Docs\\note.txt', digest: 'b'.repeat(64), mtime: Date.parse('2026-07-15T12:00:00.000Z'),
        text: 'Ligne une\nLigne deux', lineStart: 1, lineEnd: 2, method: 'utf8_text', format: 'text',
      }) },
      webReader: { read: async () => ({ evidence: [] }) },
    });

    const output = await service.readFile({ path: 'C:\\Docs\\note.txt' });
    expect(output.evidence).toEqual([expect.objectContaining({
      locator: 'C:\\Docs\\note.txt:1-2', contentDigest: `sha256:${'b'.repeat(64)}`,
      extract: 'Ligne une\nLigne deux', method: 'utf8_text',
    })]);
    expect(output.result.text).toBeUndefined();
  });
});
