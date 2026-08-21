import { describe, expect, it } from 'vitest';
import { listStacks, getStack, closestStack, STACK_CATALOG_VERSION } from '../src/code/genesis/stack-catalog.mjs';

describe('stack-catalog (genèse T1.2)', () => {
  it('catalogue versionné avec au moins 3 stacks (Gate V1)', () => {
    expect(STACK_CATALOG_VERSION).toMatch(/^\d+\.\d+\.\d+$/u);
    const ids = listStacks();
    expect(ids).toEqual(expect.arrayContaining(['node-cli', 'node-fastify', 'vite-react']));
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  it('CHAQUE stack a un squelette RÉEL : package.json valide (script test) + un test + gitignore + README', () => {
    for (const id of listStacks()) {
      const stack = getStack(id);
      expect(stack).toMatchObject({ id, type: expect.any(String), testCommand: 'npm test' });
      const files = stack.files;
      const pkg = JSON.parse(files['package.json']); // doit parser
      expect(pkg.scripts.test).toBeTruthy();
      // au moins un fichier de test avec du contenu réel
      const testFile = Object.keys(files).find((p) => p.startsWith('test/'));
      expect(testFile).toBeTruthy();
      expect(files[testFile]).toContain("node:test");
      expect(files['.gitignore']).toContain('node_modules');
      expect(files['README.md'].length).toBeGreaterThan(10);
    }
  });

  it('closestStack propose la plus proche de façon déterministe (jamais d’invention silencieuse)', () => {
    expect(closestStack('une api de notes').suggestion).toBe('node-fastify');
    expect(closestStack('un site web react').suggestion).toBe('vite-react');
    expect(closestStack('un outil cli').suggestion).toBe('node-cli');
    const unknown = closestStack('quelque chose de bizarre');
    expect(unknown.suggestion).toBeTruthy();
    expect(unknown.reason).toMatch(/inconnue/u);
  });

  it('getStack sur un id inconnu → null (jamais un squelette inventé)', () => {
    expect(getStack('cobol-mainframe')).toBeNull();
  });
});
