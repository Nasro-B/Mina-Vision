import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('YouTube Data API runtime wiring', () => {
  it('exposes encrypted configuration, bounded IPC search and browser fallback', () => {
    const main = readFileSync(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../src/ui/preload.cjs', import.meta.url), 'utf8');
    const renderer = readFileSync(new URL('../src/ui/renderer.js', import.meta.url), 'utf8');

    expect(main).toContain("createYouTubeDataClient");
    expect(main).toContain("ipcMain.handle('mina:youtube-search'");
    expect(main).toContain("youtube: { locality: 'cloud', network: 'internet' }");
    expect(preload).toContain("searchYouTube: (request) => ipcRenderer.invoke('mina:youtube-search', request)");
    expect(renderer).toContain('await api.searchYouTube({ query: trimmed, maxResults: 1 })');
    expect(renderer).toContain('YouTube Data API indisponible');
  });
});
