import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inventoryBrowserProfiles } from '../scripts/inventory-browser-profiles.mjs';

const roots = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe('inventaire des profils navigateur (Task 21) — read-only, jamais le contenu', async () => {
  it('liste chemin, taille, mtime et catégories SANS aucune valeur privée', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'mina-profiles-'));
    roots.push(projectRoot);
    const legacy = join(projectRoot, 'profiles');
    await mkdir(join(legacy, 'Default'), { recursive: true });
    await writeFile(join(legacy, 'Default', 'Cookies'), 'cookieValue=SECRET_FIXTURE');
    await writeFile(join(legacy, 'Default', 'Login Data'), 'password=SECRET_FIXTURE');

    const report = await inventoryBrowserProfiles({ projectRoot });
    expect(report.profiles).toHaveLength(1);
    expect(report.profiles[0]).toMatchObject({
      label: 'projet:profiles (legacy)',
      categories: expect.arrayContaining(['Cookies', 'Login Data']),
    });
    expect(report.profiles[0].sizeBytes).toBeGreaterThan(0);
    // La garde du plan : le rapport ne contient JAMAIS une valeur de cookie/identifiant.
    expect(JSON.stringify(report)).not.toMatch(/cookieValue|password|token|SECRET_FIXTURE/iu);
  });

  it('un profil absent est simplement omis — jamais créé, jamais supprimé', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'mina-vide-'));
    roots.push(projectRoot);
    const report = await inventoryBrowserProfiles({ projectRoot });
    expect(report.profiles).toEqual([]);
  });
});
