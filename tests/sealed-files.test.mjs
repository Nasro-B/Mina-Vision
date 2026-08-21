import { describe, expect, it } from 'vitest';
import { isSealed, assertPatchAllowed, listSealed } from '../src/code/self/sealed-files.mjs';

const REPO = '/repo';

describe('sealed-files (auto-modification T4.1)', () => {
  it('les fichiers de sécurité, crypto, MINA.md, LICENSE, animations vocales sont scellés', () => {
    for (const p of ['MINA.md', 'LICENSE', 'src/ui/voice-presence.mjs', 'src/security/capability-broker.mjs', 'src/safety/policy.mjs', 'src/crypto/keyring.mjs', 'src/code/self/sealed-files.mjs']) {
      expect(isSealed(p, { repoRoot: REPO })).toBe(true);
    }
  });

  it('un fichier normal N’EST PAS scellé', () => {
    expect(isSealed('src/code/genesis/project-brief.mjs', { repoRoot: REPO })).toBe(false);
    expect(isSealed('src/ui/renderer.js', { repoRoot: REPO })).toBe(false);
  });

  it('patch touchant un fichier scellé → REJET (prouvé par mutation)', () => {
    expect(() => assertPatchAllowed(['src/code/x.mjs', 'src/safety/policy.mjs'], { repoRoot: REPO })).toThrow('sealed_files');
    try {
      assertPatchAllowed(['MINA.md'], { repoRoot: REPO });
    } catch (e) {
      expect(e.sealed).toContain('MINA.md');
    }
  });

  it('contournement : chemin qui S’ÉCHAPPE du repo (../, absolu ailleurs) → traité comme scellé', () => {
    expect(isSealed('../etc/passwd', { repoRoot: REPO })).toBe(true);
    expect(isSealed('/etc/hosts', { repoRoot: REPO })).toBe(true);
    // un rename d'un fichier scellé fait apparaître l'ancien chemin → rejet
    expect(() => assertPatchAllowed(['src/crypto/keyring.mjs', 'src/crypto/keyring-renamed.mjs'], { repoRoot: REPO })).toThrow('sealed_files');
  });

  it('patch propre (aucun scellé) → autorisé', () => {
    expect(assertPatchAllowed(['src/code/a.mjs', 'tests/a.test.mjs'], { repoRoot: REPO })).toBe(true);
  });

  it('listSealed expose la liste (dont ce module lui-même)', () => {
    expect(listSealed()).toContain('src/code/self/sealed-files.mjs');
  });
});
