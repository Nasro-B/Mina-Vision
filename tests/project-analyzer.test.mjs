import { describe, expect, it, vi } from 'vitest';
import { createProjectAnalyzer } from '../src/code/lifecycle/project-analyzer.mjs';

function fakeFs(pkg, { dirs = [] } = {}) {
  return {
    readJson: vi.fn(async () => pkg),
    exists: vi.fn(async (p) => dirs.some((d) => p.endsWith(d))),
  };
}

describe('project-analyzer (cycle de vie T3.1)', () => {
  it('exige fs', () => {
    expect(() => createProjectAnalyzer({ fs: {} })).toThrow('fs_required');
  });

  it('détecte Vite+React, scripts, tests, git propre → rapport parlable', async () => {
    const pkg = { name: 'mon-site', dependencies: { react: '^19' }, devDependencies: { vite: '^6' }, scripts: { dev: 'vite', test: 'vitest' } };
    const runCommand = vi.fn(async () => ({ stdout: '' }));
    const analyzer = createProjectAnalyzer({ fs: fakeFs(pkg), runCommand });
    const r = await analyzer.analyze('/projets/mon-site');
    expect(r).toMatchObject({ name: 'mon-site', stack: 'vite-react', type: 'web', hasTests: true, git: 'propre' });
    expect(r.report).toMatch(/vite-react.*tests présents.*git propre/u);
  });

  it('HONNÊTE : projet SANS tests → le dit (jamais « testé »)', async () => {
    const pkg = { name: 'brut', dependencies: {}, scripts: { start: 'node .' } };
    const analyzer = createProjectAnalyzer({ fs: fakeFs(pkg) });
    const r = await analyzer.analyze('/x');
    expect(r.hasTests).toBe(false);
    expect(r.report).toMatch(/AUCUN test/u);
  });

  it('détecte fastify (api) et cli (bin) ; stack inconnue → null jamais inventée', async () => {
    const fastify = createProjectAnalyzer({ fs: fakeFs({ dependencies: { fastify: '^5' } }) });
    expect((await fastify.analyze('/a')).stack).toBe('node-fastify');
    const cli = createProjectAnalyzer({ fs: fakeFs({ bin: { app: 'src/i.mjs' } }) });
    expect((await cli.analyze('/b')).stack).toBe('node-cli');
    const unknown = createProjectAnalyzer({ fs: fakeFs({ dependencies: { leftpad: '1' } }) });
    expect((await unknown.analyze('/c')).stack).toBeNull();
  });

  it('git modifié détecté via runCommand', async () => {
    const analyzer = createProjectAnalyzer({ fs: fakeFs({ name: 'x' }), runCommand: async () => ({ stdout: ' M src/a.mjs\n' }) });
    expect((await analyzer.analyze('/x')).git).toBe('modifié');
  });
});
