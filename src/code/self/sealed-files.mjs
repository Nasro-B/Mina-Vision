import path from 'node:path';

// Auto-modification T4.1 (SPEC agente-codage V4) — constitution T0.1. Liste SCELLÉE des fichiers que
// l'auto-modification de Mina ne touche JAMAIS : le cœur de sécurité (broker/autorisation, politique de
// sûreté), la cryptographie/keyring, ce module lui-même, le checkpoint/rollback (V5), MINA.md, la LICENSE
// et les animations vocales (verrouillées par tests). Toute modification touchant un chemin scellé est
// REJETÉE AVANT même la création du worktree. Résiste au contournement : un rename/suppression fait
// apparaître l'ancien chemin scellé dans le diff (→ rejet), et un chemin qui s'échappe du repo (`..`,
// absolu hors racine) est traité comme scellé (jamais toucher hors périmètre). Module PUR.

const SEALED_FILES = Object.freeze([
  'MINA.md',
  'LICENSE',
  'src/ui/voice-presence.mjs', // orbe Mina + CloudZIR, verrouillés par régression
  'src/code/self/sealed-files.mjs',
  'src/code/self/checkpoint-ledger.mjs',
  'src/code/self/rollback-service.mjs',
]);

// Répertoires scellés en ENTIER (tout fichier dessous est scellé).
const SEALED_DIRS = Object.freeze(['src/security/', 'src/safety/', 'src/crypto/']);

function toRepoRelative(target, repoRoot) {
  const root = path.resolve(repoRoot ?? '.');
  const rel = path.relative(root, path.resolve(root, String(target ?? '')));
  return rel.split(path.sep).join('/');
}

export function isSealed(target, { repoRoot = '.' } = {}) {
  const rel = toRepoRelative(target, repoRoot);
  if (rel === '' || rel.startsWith('..')) return true; // hors repo / racine nue → scellé par prudence
  if (SEALED_FILES.includes(rel)) return true;
  return SEALED_DIRS.some((dir) => rel === dir.slice(0, -1) || rel.startsWith(dir));
}

// Lève si UN SEUL des chemins modifiés touche un fichier scellé (rejet avant worktree).
export function assertPatchAllowed(changedPaths = [], options = {}) {
  const violations = (changedPaths ?? []).filter((p) => isSealed(p, options));
  if (violations.length > 0) {
    const error = new Error('self_change_touches_sealed_files');
    error.sealed = Object.freeze(violations);
    throw error;
  }
  return true;
}

export function listSealed() {
  return Object.freeze([...SEALED_FILES, ...SEALED_DIRS]);
}
