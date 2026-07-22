// Inventaire READ-ONLY des profils navigateur (Task 21) : chemin, taille, dernière
// modification et catégories de données présentes — JAMAIS le contenu (ni cookies, ni
// identifiants, ni historique). Aucune suppression : la décision appartient à Nasro
// (docs/operations/BROWSER-PROFILE-MIGRATION.md).

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const DATA_CATEGORIES = ['Cookies', 'Login Data', 'Web Data', 'History'];

async function directorySize(directory, budget = { files: 0 }) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    // Borne dure : un profil Chromium contient des dizaines de milliers de fichiers de cache —
    // au-delà, la taille est annoncée comme partielle plutôt que de scanner sans fin.
    if (budget.files > 20_000) return total;
    budget.files += 1;
    const absolute = join(directory, entry.name);
    try {
      if (entry.isDirectory()) total += await directorySize(absolute, budget);
      else total += (await stat(absolute)).size;
    } catch { /* fichier verrouillé par un navigateur ouvert : ignoré */ }
  }
  return total;
}

async function inspectProfile(root, label) {
  let info;
  try {
    info = await stat(root);
  } catch {
    return null;
  }
  if (!info.isDirectory()) return null;
  const categories = [];
  // Les bases Chromium vivent dans le profil racine ou dans Default/.
  for (const base of [root, join(root, 'Default')]) {
    for (const category of DATA_CATEGORIES) {
      try {
        await stat(join(base, category));
        if (!categories.includes(category)) categories.push(category);
      } catch { /* absent */ }
    }
  }
  const budget = { files: 0 };
  const sizeBytes = await directorySize(root, budget);
  return Object.freeze({
    label,
    path: root,
    sizeBytes,
    sizePartial: budget.files > 20_000,
    lastModified: new Date(info.mtimeMs).toISOString(),
    categories: Object.freeze(categories),
  });
}

export async function inventoryBrowserProfiles({ projectRoot, userDataRoot } = {}) {
  const candidates = [
    { root: join(projectRoot ?? process.cwd(), 'profiles'), label: 'projet:profiles (legacy)' },
    ...(userDataRoot
      ? [
        { root: join(userDataRoot, 'mina-chrome-profile'), label: 'userData:mina-chrome-profile (actif)' },
        { root: join(userDataRoot, 'chrome-profile'), label: 'userData:chrome-profile (legacy)' },
      ]
      : []),
  ];
  const profiles = [];
  for (const candidate of candidates) {
    const report = await inspectProfile(candidate.root, candidate.label);
    if (report) profiles.push(report);
  }
  return Object.freeze({ generatedAt: new Date().toISOString(), profiles: Object.freeze(profiles) });
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/u).pop());
if (invokedDirectly) {
  const userDataRoot = process.env.MINA_USER_DATA
    ?? join(process.env.APPDATA ?? '', 'Mina Vision');
  const report = await inventoryBrowserProfiles({ projectRoot: process.cwd(), userDataRoot });
  console.log(JSON.stringify(report, null, 2));
}
