import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('main host write policy contract', () => {
  it('preflights desktop missions and guards user-selected host exports', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');

    expect(source).toContain('createHostWritePolicy');
    expect(source).toContain('hostWritePolicy.requiresMissionConfirmation');
    expect(source).toContain('hostWritePolicy.authorize(filename)');
  });

  it('aucune racine de l\'ancien Mina AI ne survit dans le code actif (grep-contract R-06)', async () => {
    const roots = ['src', 'scripts', 'config'];
    const forbidden = ['Mina AI', 'Mina API', 'Mina APP', 'Mina Modal'];
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const files = [];
    const walk = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else if (/\.(mjs|cjs|js|json|ps1|cmd)$/u.test(entry.name)) files.push(absolute);
      }
    };
    for (const root of roots) {
      await walk(fileURLToPath(new URL(`../${root}`, import.meta.url)));
    }
    const contents = await Promise.all(files.map(async (file) => ({ file, content: await readFile(file, 'utf8') })));
    const offenders = [];
    for (const { file, content } of contents) {
      for (const needle of forbidden) {
        if (content.includes(`G:\\\\Serveurs\\\\${needle}`) || content.includes(`G:\\Serveurs\\${needle}`)) {
          offenders.push(`${file} → ${needle}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
