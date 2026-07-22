import { describe, expect, it } from 'vitest';
import { createProjectContextLoader } from '../../src/code/intelligence/project-context-loader.mjs';

function createFakeFs(files, directories = {}) {
  return {
    readFile: async (path) => {
      const normalized = path.replace(/\\/gu, '/');
      if (normalized in files) return files[normalized];
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    readdir: async (path) => {
      const normalized = path.replace(/\\/gu, '/');
      if (!(normalized in directories)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return directories[normalized].map((entry) => ({
        name: entry.name,
        isDirectory: () => entry.type === 'dir',
        isSymbolicLink: () => entry.type === 'symlink',
      }));
    },
  };
}

const ROOT = 'C:/projets/demo';

describe('project-context-loader', () => {
  it('exige un fileReader et une racine', async () => {
    expect(() => createProjectContextLoader()).toThrow(/file_reader_required/u);
    const loader = createProjectContextLoader({ fileReader: createFakeFs({}) });
    await expect(loader.load('')).rejects.toThrow(/root_required/u);
  });

  it('charge MINA.md en PLUS de AGENTS.md/CLAUDE.md/.codex — correction du design de la spec', async () => {
    const loader = createProjectContextLoader({
      fileReader: createFakeFs({
        [`${ROOT}/MINA.md`]: '# Mina règles',
        [`${ROOT}/AGENTS.md`]: '# Agents',
        [`${ROOT}/CLAUDE.md`]: '# Claude',
        [`${ROOT}/.codex/AGENTS.md`]: '# Codex',
      }, { [ROOT]: [] }),
    });
    const context = await loader.load(ROOT);
    expect(context.minaMd).toBe('# Mina règles');
    expect(context.agentsMd).toBe('# Agents');
    expect(context.claudeMd).toBe('# Claude');
    expect(context.codexMd).toBe('# Codex');
  });

  it('retourne null (fail-soft) pour chaque fichier absent, jamais d\'exception', async () => {
    const loader = createProjectContextLoader({ fileReader: createFakeFs({}, { [ROOT]: [] }) });
    const context = await loader.load(ROOT);
    expect(context.minaMd).toBeNull();
    expect(context.agentsMd).toBeNull();
    expect(context.packageJson).toBeNull();
    expect(context.framework).toBeNull();
    expect(context.tree).toEqual([]);
  });

  it('parse package.json et expose scripts + dépendances fusionnées', async () => {
    const loader = createProjectContextLoader({
      fileReader: createFakeFs({
        [`${ROOT}/package.json`]: JSON.stringify({
          scripts: { test: 'vitest run' },
          dependencies: { electron: '43.0.0' },
          devDependencies: { vitest: '4.0.0' },
        }),
      }, { [ROOT]: [] }),
    });
    const context = await loader.load(ROOT);
    expect(context.scripts.test).toBe('vitest run');
    expect(context.dependencies).toMatchObject({ electron: '43.0.0', vitest: '4.0.0' });
  });

  it('détecte les frameworks depuis les dépendances et fichiers racine (Electron prioritaire)', async () => {
    const loader = createProjectContextLoader({
      fileReader: createFakeFs({
        [`${ROOT}/package.json`]: JSON.stringify({
          dependencies: { electron: '43', react: '19' },
          devDependencies: { vitest: '4' },
        }),
      }, { [ROOT]: [{ name: 'wrangler.toml', type: 'file' }] }),
    });
    const context = await loader.load(ROOT);
    expect(context.framework).toBe('Electron');
    expect(context.frameworks).toContain('React');
    expect(context.frameworks).toContain('Vitest');
    expect(context.frameworks).toContain('Cloudflare Workers');
  });

  it('package.json corrompu → null, sans exception', async () => {
    const loader = createProjectContextLoader({
      fileReader: createFakeFs({ [`${ROOT}/package.json`]: '{invalid' }, { [ROOT]: [] }),
    });
    const context = await loader.load(ROOT);
    expect(context.packageJson).toBeNull();
  });

  it('liste l\'arborescence à profondeur 2 en ignorant node_modules/.git et TOUS les symlinks', async () => {
    const loader = createProjectContextLoader({
      fileReader: createFakeFs({}, {
        [ROOT]: [
          { name: 'src', type: 'dir' },
          { name: 'node_modules', type: 'dir' },
          { name: '.git', type: 'dir' },
          { name: 'lien-cache', type: 'symlink' },
          { name: 'package.json', type: 'file' },
        ],
        [`${ROOT}/src`]: [
          { name: 'ui', type: 'dir' },
          { name: 'app.mjs', type: 'file' },
        ],
        [`${ROOT}/src/ui`]: [
          { name: 'trop-profond.mjs', type: 'file' },
        ],
      }),
    });
    const context = await loader.load(ROOT);
    expect(context.tree).toContain('src/');
    expect(context.tree).toContain('src/app.mjs');
    expect(context.tree).toContain('src/ui/');
    expect(context.tree).not.toContain('node_modules/');
    expect(context.tree).not.toContain('lien-cache');
    expect(context.tree).not.toContain('src/ui/trop-profond.mjs');
  });

  it('tronque les documents géants à 64 000 caractères', async () => {
    const loader = createProjectContextLoader({
      fileReader: createFakeFs({ [`${ROOT}/README.md`]: 'x'.repeat(100_000) }, { [ROOT]: [] }),
    });
    const context = await loader.load(ROOT);
    expect(context.readme.length).toBeLessThan(64_100);
    expect(context.readme.endsWith('…[tronqué]')).toBe(true);
  });

  it('trouve le premier fichier de config existant (eslint/prettier/vitest)', async () => {
    const loader = createProjectContextLoader({
      fileReader: createFakeFs({
        [`${ROOT}/.eslintrc.json`]: '{}',
        [`${ROOT}/vitest.config.mjs`]: 'export default {}',
      }, { [ROOT]: [] }),
    });
    const context = await loader.load(ROOT);
    expect(context.eslintConfig.file).toBe('.eslintrc.json');
    expect(context.vitestConfig.file).toBe('vitest.config.mjs');
    expect(context.prettierConfig).toBeNull();
  });

  it('le contexte retourné est gelé', async () => {
    const loader = createProjectContextLoader({ fileReader: createFakeFs({}, { [ROOT]: [] }) });
    const context = await loader.load(ROOT);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.tree)).toBe(true);
  });
});
