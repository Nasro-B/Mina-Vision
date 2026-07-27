// Gate « clone propre » (finding F-01 de l'audit 2026-07-27, CRITIQUE) : quatre modules
// `src/emergency/*` étaient importés au démarrage mais IGNORÉS par git (motif `emergency/` sans
// ancre dans .gitignore, destiné à un dossier de DONNÉES à la racine, qui fauchait le code source
// par effet collatéral). Conséquence : un clone du dépôt public ne démarrait pas
// (ERR_MODULE_NOT_FOUND), alors que le poste de développement fonctionnait — les fichiers y
// existaient hors git.
//
// Ce contrat rend cette classe de défaut impossible à réintroduire : TOUT fichier source présent
// sur le disque sous les racines de code doit être suivi par git. Il ne teste pas seulement les
// quatre fichiers du finding — il teste l'invariant.

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Sous Windows, `git` est un `.exe` que Node ne résout pas toujours depuis le PATH du runner de
// test ; `shell` laisse PATHEXT faire son travail. Aucun risque d'injection : les arguments sont
// des constantes de ce fichier, jamais une entrée externe.
const git = (args, input) => execFileSync('git', args, {
  cwd: ROOT,
  encoding: 'utf8',
  input,
  shell: process.platform === 'win32',
});

const gitLsFiles = () => git(['ls-files']);

// Fichiers que .gitignore EXCLUT parmi ceux passés. On teste l'exclusion, pas « déjà commité » :
// un fichier neuf pas encore ajouté est un état de travail normal, alors qu'un fichier IGNORÉ est
// invisible pour toujours — c'est exactement le piège de F-01.
function ignoredAmong(files) {
  if (files.length === 0) return [];
  try {
    return git(['check-ignore', '--stdin'], files.join('\n'))
      .split('\n')
      .map((line) => line.trim().split(sep).join('/'))
      .filter(Boolean);
  } catch (error) {
    // `git check-ignore` sort en code 1 quand AUCUN fichier n'est ignoré : ce n'est pas une erreur.
    if (error?.status === 1) return [];
    throw error;
  }
}
const SOURCE_ROOTS = ['src', 'tests', 'scripts'];
const SOURCE_EXTENSIONS = ['.mjs', '.js', '.cjs'];
// Dossiers de contenu généré/tiers : jamais du source à versionner.
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'build', 'coverage', 'dist']);

function listSourceFiles(directory, accumulator = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return accumulator; // racine absente = rien à vérifier
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      listSourceFiles(join(directory, entry.name), accumulator);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      accumulator.push(join(directory, entry.name));
    }
  }
  return accumulator;
}

const trackedFiles = new Set(
  gitLsFiles()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
);

const onDisk = SOURCE_ROOTS.flatMap((root) => listSourceFiles(join(ROOT, root)))
  .map((absolute) => relative(ROOT, absolute).split(sep).join('/'));

describe('complétude du dépôt : un clone propre contient tout le code exécuté', () => {
  it('aucun fichier source n\'est EXCLU par .gitignore (F-01)', () => {
    const ignored = ignoredAmong(onDisk).sort();
    // Message explicite : la cause est presque toujours un motif .gitignore trop large.
    expect(ignored, `Fichiers source exclus par .gitignore (un clone ne les aurait JAMAIS) :\n${ignored.join('\n')}\n`
      + 'Cause habituelle : un motif sans ancre (« nom/ » matche à toute profondeur ; utiliser « /nom/ »).')
      .toEqual([]);
  });

  it('les modules du domaine emergency, importés au boot, sont bien versionnés (régression F-01)', () => {
    // Ancrage explicite sur le finding d'origine : ces quatre-là étaient invisibles d'un clone.
    for (const file of [
      'src/emergency/network-policy.mjs',
      'src/emergency/device-guard.mjs',
      'src/emergency/emergency-mode.mjs',
      'src/emergency/emergency-corpus.mjs',
    ]) {
      expect(trackedFiles.has(file), `${file} doit être suivi par git`).toBe(true);
    }
  });
});
