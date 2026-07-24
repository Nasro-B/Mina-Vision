import { describe, expect, it } from 'vitest';
import { createGitignoreMatcher } from '../src/code/intelligence/gitignore-matcher.mjs';

describe('createGitignoreMatcher', () => {
  it('ignore un fichier nommé à la racine', () => {
    const m = createGitignoreMatcher('agent_vision_sourire.js\ndebug_dom.js\n');
    expect(m.ignores('agent_vision_sourire.js')).toBe(true);
    expect(m.ignores('debug_dom.js')).toBe(true);
    expect(m.ignores('src/code/code-services.mjs')).toBe(false);
  });

  it('un nom de base sans slash matche à toute profondeur', () => {
    const m = createGitignoreMatcher('*.log\n');
    expect(m.ignores('boot.log')).toBe(true);
    expect(m.ignores('logs/deep/trace.log')).toBe(true);
    expect(m.ignores('src/app.mjs')).toBe(false);
  });

  it('un dossier ignoré emporte tout son contenu', () => {
    const m = createGitignoreMatcher('env/\ndocs/superpowers/plans/\n');
    expect(m.ignores('env', true)).toBe(true);
    expect(m.ignores('env/google-services.json')).toBe(true);
    expect(m.ignores('docs/superpowers/plans/x.md')).toBe(true);
    expect(m.ignores('docs/superpowers/specs/y.md')).toBe(false);
  });

  it('la négation réautorise (dernier motif gagnant)', () => {
    const m = createGitignoreMatcher('.env\n.env.*\n!.env.example\n');
    expect(m.ignores('.env')).toBe(true);
    expect(m.ignores('.env.local')).toBe(true);
    expect(m.ignores('.env.example')).toBe(false);
  });

  it('gère `**` à travers les segments', () => {
    const m = createGitignoreMatcher('android/**/build/\n');
    expect(m.ignores('android/app/build', true)).toBe(true);
    expect(m.ignores('android/app/build/outputs/apk/app.apk')).toBe(true);
    expect(m.ignores('android/app/src/Main.kt')).toBe(false);
  });

  it('`directory-only` (slash final) n\'écarte pas un fichier homonyme', () => {
    const m = createGitignoreMatcher('build/\n');
    expect(m.ignores('build', true)).toBe(true);
    expect(m.ignores('build', false)).toBe(false); // un fichier nommé "build" reste visible
  });

  it('un motif ancré ne matche pas un homonyme en profondeur', () => {
    const m = createGitignoreMatcher('/android/local.properties\n');
    expect(m.ignores('android/local.properties')).toBe(true);
    expect(m.ignores('src/android/local.properties')).toBe(false);
  });

  it('ignore commentaires et lignes vides', () => {
    const m = createGitignoreMatcher('# commentaire\n\n   \n*.apk\n');
    expect(m.ignores('app.apk')).toBe(true);
    expect(m.ignores('app.mjs')).toBe(false);
  });

  it('le vrai .gitignore du projet écarte les prototypes et garde le source', () => {
    const real = [
      '.env', '.env.*', '!.env.example', 'env/', 'node_modules/', 'coverage/', '*.log',
      'docs/superpowers/plans/', 'android/**/build/', '*.apk',
      'agent_vision_sourire.js', 'debug_dom.js', 'diagnostic_scroll.js', 'modal_vision_app.py',
    ].join('\n');
    const m = createGitignoreMatcher(real);
    for (const ignored of ['agent_vision_sourire.js', 'debug_dom.js', 'diagnostic_scroll.js', 'env/google-services.json']) {
      expect(m.ignores(ignored)).toBe(true);
    }
    for (const kept of ['src/code/code-services.mjs', 'src/ui/main.mjs', 'tests/phone-bridge.test.mjs']) {
      expect(m.ignores(kept)).toBe(false);
    }
  });
});
