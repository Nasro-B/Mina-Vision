import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSkillLoader } from '../src/skills/skill-loader.mjs';
import { createSkillRegistry } from '../src/skills/skill-registry.mjs';

// Contrat de dépôt (plan de durcissement T0.3) — pendant du générateur sûr.
//
// Le générateur empêche d'ÉCRIRE un skill mal formé ; ce contrat vérifie ce qui est réellement
// dans le dépôt, quelle que soit la voie d'entrée (génération, copie manuelle, commit d'un autre
// agent). Il existe parce que le registre est volontairement TOLÉRANT depuis le 1377861 : un skill
// illisible est désormais ignoré au lieu de tuer le démarrage — ce qui protège l'application mais
// rend une régression SILENCIEUSE. Ici, le silence est une erreur.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_ROOT = join(ROOT, 'skills-reference');

async function skillDirectories() {
  const entries = await readdir(SKILLS_ROOT, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function filesUnder(directory, current = directory, output = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) await filesUnder(directory, absolute, output);
    else output.push(relative(directory, absolute).split(sep).join('/'));
  }
  return output;
}

describe('skills-reference — structure du dépôt', () => {
  it('chaque dossier expose son SKILL.md à la racine du slug', async () => {
    for (const slug of await skillDirectories()) {
      const document = join(SKILLS_ROOT, slug, 'SKILL.md');
      await expect(stat(document).then((entry) => entry.isFile()), `${slug}/SKILL.md`).resolves.toBe(true);
    }
  });

  it("aucun skill n'est imbriqué dans un dossier portant son propre nom", async () => {
    for (const slug of await skillDirectories()) {
      const paths = await filesUnder(join(SKILLS_ROOT, slug));
      // Les deux formes exactes de l'incident du 2026-07-27, qui démarrait l'application sans
      // aucune fenêtre : `<slug>/<slug>/…` et un second SKILL.md en profondeur.
      expect(paths.filter((path) => path.split('/')[0] === slug), `${slug} : imbrication`).toEqual([]);
      expect(paths.filter((path) => path !== 'SKILL.md' && path.endsWith('SKILL.md')), `${slug} : SKILL.md profond`)
        .toEqual([]);
    }
  });

  it('AUCUN skill du dépôt n’est ignoré en silence par le registre', async () => {
    const directories = await skillDirectories();
    const listed = await createSkillRegistry({ root: SKILLS_ROOT }).scan();
    // Le registre ignore un skill illisible ou resté au condensat marqueur : comparer les deux
    // listes est le seul moyen de voir un skill qui « existe » sans jamais être disponible.
    expect(listed.map((entry) => entry.slug).sort()).toEqual(directories);
  });

  it('chaque skill se charge vraiment, condensat vérifié sur les octets publiés', async () => {
    const loader = createSkillLoader({ root: SKILLS_ROOT });
    const registry = createSkillRegistry({ root: SKILLS_ROOT });
    await registry.scan();
    for (const slug of await skillDirectories()) {
      // `load()` recalcule le manifeste et refuse tout écart : un fichier modifié sans mise à jour
      // du condensat échoue ici, pas chez l'utilisateur.
      const loaded = await loader.load(slug);
      expect(loaded.digest, `${slug} : condensat`).toMatch(/^sha256:[a-f0-9]{64}$/u);
      // Le nom déclaré n'est PAS tenu d'égaler le slug : le schéma ne l'impose pas et
      // `mythos-mina-skill` s'appelle `mythos` depuis toujours. Ce qui doit tenir, c'est que les
      // deux index — le registre par nom, le chargeur par dossier — désignent le même skill.
      expect(registry.get(loaded.name)?.slug, `${slug} : index registre`).toBe(slug);
    }
  });
});
