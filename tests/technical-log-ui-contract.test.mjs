import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const load = (path) => readFile(new URL(path, import.meta.url), 'utf8');

describe('technical log UI contract', () => {
  it('exposes a dedicated bounded technical log panel outside the Guide page', async () => {
    const [html, renderer, preload, main] = await Promise.all([
      load('../src/ui/index.html'), load('../src/ui/renderer.js'),
      load('../src/ui/preload.cjs'), load('../src/ui/main.mjs'),
    ]);

    expect(html).toContain('id="technical-log"');
    expect(html).toContain('id="technical-log-clear"');
    expect(renderer).toContain('api.listTechnicalLogs()');
    expect(renderer).toContain('api.onTechnicalLog');
    expect(preload).toContain("ipcRenderer.invoke('mina:technical-log:list')");
    expect(preload).toContain("ipcRenderer.invoke('mina:technical-log:clear')");
    expect(preload).toContain("ipcRenderer.invoke('mina:technical-log:record'");
    expect(main).toContain("ipcMain.handle('mina:technical-log:list'");
    expect(main).toContain("ipcMain.handle('mina:technical-log:clear'");
    expect(main).toContain("ipcMain.handle('mina:technical-log:record'");
  });
});
