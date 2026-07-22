import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const DANGEROUS_PATTERNS = Object.freeze([
  { name: 'innerHTML assignment', regex: /\.innerHTML\s*=/u },
  { name: 'outerHTML assignment', regex: /\.outerHTML\s*=/u },
  { name: 'insertAdjacentHTML', regex: /insertAdjacentHTML\s*\(/u },
  { name: 'document.write', regex: /document\.write\s*\(/u },
  { name: 'eval', regex: /(?<![.\w])eval\s*\(/u },
  { name: 'new Function', regex: /new\s+Function\s*\(/u },
]);

const RENDERER_FILES = Object.freeze([
  'src/ui/renderer.js',
  'src/ui/controller.mjs',
  'src/ui/preload.cjs',
]);

describe('UI security contract: no HTML-injection escape hatch anywhere in the renderer/preload surface', () => {
  it.each(RENDERER_FILES)('%s never uses innerHTML/outerHTML/insertAdjacentHTML/document.write/eval/new Function', async (relativePath) => {
    const source = await readFile(relativePath, 'utf8');
    for (const { name, regex } of DANGEROUS_PATTERNS) {
      expect(regex.test(source), `${relativePath} contains a ${name} occurrence`).toBe(false);
    }
  });
});

describe('UI security contract: preload never exposes a raw/generic IPC escape hatch', () => {
  it('preload.cjs never exposes ipcRenderer.invoke/send/on directly by a generic name', async () => {
    const source = await readFile('src/ui/preload.cjs', 'utf8');
    expect(source).not.toMatch(/invoke\s*:\s*ipcRenderer\.invoke\s*,?\s*$/mu);
    expect(source).not.toMatch(/send\s*:\s*ipcRenderer\.send\s*,?\s*$/mu);
    expect(source).not.toMatch(/\.\.\.\s*ipcRenderer\b/u);
  });

  it('preload.cjs only ever bridges the curated createPreloadApi surface, never contextBridge.exposeInMainWorld with a raw object literal containing ipcRenderer', async () => {
    const source = await readFile('src/ui/preload.cjs', 'utf8');
    expect(source).toContain('createPreloadApi(ipcRenderer)');
    expect(source).not.toMatch(/exposeInMainWorld\([^)]*\{[^}]*ipcRenderer/su);
  });
});

describe('UI security contract: the recovery phrase is only ever rendered once, right after generation', () => {
  it('recoveryOutput.textContent is assigned in exactly one place in renderer.js', async () => {
    const source = await readFile('src/ui/renderer.js', 'utf8');
    const assignments = source.match(/elements\.recoveryOutput\.textContent\s*=/gu) ?? [];
    expect(assignments).toHaveLength(1);
  });

  it('the recovery phrase input is cleared immediately after use, never left populated', async () => {
    const source = await readFile('src/ui/renderer.js', 'utf8');
    expect(source).toMatch(/elements\.recoveryPhrase\.value\s*=\s*['"]{2}/u);
  });
});
