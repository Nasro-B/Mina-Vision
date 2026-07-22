import { describe, expect, it } from 'vitest';
import { normalizeCodeAction, normalizeProjectPath } from '../../src/code/code-action-normalizer.mjs';

describe('code-action-normalizer — chemins', () => {
  it('normalise les séparateurs Windows et les segments « . »', () => {
    expect(normalizeProjectPath('src\\ui\\.\\main.mjs')).toBe('src/ui/main.mjs');
  });

  it.each([
    'C:\\Windows\\system32',
    '/etc/passwd',
    '~/secret',
    '../autre-projet/fichier.mjs',
    'src/../../evasion.mjs',
  ])('rejette l\'échappement du projet : « %s »', (path) => {
    expect(() => normalizeProjectPath(path)).toThrow(/code_action_invalid/u);
  });

  it('rejette l\'octet nul et les chemins vides', () => {
    expect(() => normalizeProjectPath('a\0b')).toThrow(/octet nul/u);
    expect(() => normalizeProjectPath('')).toThrow(/code_action_invalid/u);
    expect(() => normalizeProjectPath('./')).toThrow(/code_action_invalid/u);
  });
});

describe('code-action-normalizer — actions', () => {
  it('normalise code.read/code.write avec chemins confinés', () => {
    const read = normalizeCodeAction({ type: 'code.read', arguments: { path: 'src/app.mjs', intent: 'lire' } });
    expect(read).toEqual({ type: 'code.read', intent: 'lire', path: 'src/app.mjs' });
    expect(Object.isFrozen(read)).toBe(true);

    const write = normalizeCodeAction({ type: 'code.write', arguments: { path: 'src/app.mjs', content: 'export {};' } });
    expect(write.content).toBe('export {};');
  });

  it('accepte la forme functionCall {name, args}', () => {
    const action = normalizeCodeAction({ name: 'code.search', args: { query: 'jwt', maxResults: 5 } });
    expect(action.type).toBe('code.search');
    expect(action.maxResults).toBe(5);
  });

  it('rejette un type inconnu', () => {
    expect(() => normalizeCodeAction({ type: 'code.push' })).toThrow(/code_action_unknown/u);
    expect(() => normalizeCodeAction({ type: 'shell.exec' })).toThrow(/code_action_unknown/u);
  });

  it('rejette les arguments interdits (shell, sudo, …)', () => {
    expect(() => normalizeCodeAction({ type: 'code.read', arguments: { path: 'a.mjs', shell: 'bash' } }))
      .toThrow(/argument interdit/u);
  });

  it('code.git.commit exige un message et confine les fichiers', () => {
    const action = normalizeCodeAction({
      type: 'code.git.commit',
      arguments: { message: 'feat(x): y', files: ['src/a.mjs', 'tests\\a.test.mjs'] },
    });
    expect(action.files).toEqual(['src/a.mjs', 'tests/a.test.mjs']);
    expect(() => normalizeCodeAction({ type: 'code.git.commit', arguments: {} })).toThrow(/message requis/u);
    expect(() => normalizeCodeAction({ type: 'code.git.commit', arguments: { message: 'x', files: ['../../evasion'] } }))
      .toThrow(/sort du projet/u);
  });

  it('code.sandbox.run n\'accepte que python/javascript/powershell', () => {
    const action = normalizeCodeAction({ type: 'code.sandbox.run', arguments: { language: 'Python', source: 'print(1)' } });
    expect(action.language).toBe('python');
    expect(() => normalizeCodeAction({ type: 'code.sandbox.run', arguments: { language: 'bash', source: 'ls' } }))
      .toThrow(/language non supporté/u);
  });

  it('code.plan.create valide titre et étapes bornées', () => {
    const action = normalizeCodeAction({
      type: 'code.plan.create',
      arguments: { title: 'Plan', steps: [{ description: 'a' }, 'b'] },
    });
    expect(action.steps).toEqual(['a', 'b']);
    expect(() => normalizeCodeAction({ type: 'code.plan.create', arguments: { title: 'Plan', steps: Array(51).fill('x') } }))
      .toThrow(/steps invalide/u);
  });

  it('code.plan.update exige planId, stepId et status', () => {
    const action = normalizeCodeAction({
      type: 'code.plan.update',
      arguments: { planId: 'p1', stepId: 's2', status: 'completed' },
    });
    expect(action).toMatchObject({ planId: 'p1', stepId: 's2', status: 'completed' });
    expect(() => normalizeCodeAction({ type: 'code.plan.update', arguments: { planId: 'p1' } })).toThrow(/stepId requis/u);
  });

  it('borne maxResults de code.search', () => {
    expect(() => normalizeCodeAction({ type: 'code.search', arguments: { query: 'q', maxResults: 0 } }))
      .toThrow(/maxResults hors limites/u);
    expect(() => normalizeCodeAction({ type: 'code.search', arguments: { query: 'q', maxResults: 101 } }))
      .toThrow(/maxResults hors limites/u);
  });

  it('borne la taille du contenu écrit', () => {
    expect(() => normalizeCodeAction({
      type: 'code.write',
      arguments: { path: 'a.mjs', content: 'x'.repeat(1_000_001) },
    })).toThrow(/content trop long/u);
  });

  it('conserve la commande éventuelle pour la politique de sécurité (bornée)', () => {
    const action = normalizeCodeAction({
      type: 'code.test.run',
      arguments: { command: 'npm test' },
    });
    expect(action.command).toBe('npm test');
  });
});
