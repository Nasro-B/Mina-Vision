// Installation d'un skill au format « .skill » (archive zip, ex. mythos.skill converti) via le
// VRAI flux stage → audit → confirmation → install → load. Prouve : extension .skill acceptée,
// digest du convertisseur valide, références chargées, contenu intact.

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSkillInstaller } from '../src/skills/skill-installer.mjs';
import { createSkillLoader } from '../src/skills/skill-loader.mjs';

const CONVERTED = 'C:/Serveurs/mythos.mina.skill';
let convertedExists = true;
try {
  await readFile(CONVERTED);
} catch {
  convertedExists = false;
}

describe.skipIf(!convertedExists)('installation d\'un .skill converti (mythos)', () => {
  let workRoot;
  let installer;
  let confirmations;

  beforeAll(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'mina-skill-install-'));
    confirmations = [];
    installer = createSkillInstaller({
      quarantineRoot: join(workRoot, 'quarantine'),
      skillsRoot: join(workRoot, 'skills'),
      // Confirmation locale simulée : enregistre ce qui est demandé, approuve avec le digest exact
      // (dans l'app réelle, c'est le dialogue de confirmation de Nasro qui joue ce rôle).
      confirmLocal: async ({ action }) => {
        confirmations.push(action);
        return { approved: true, token: `token-${confirmations.length}`, digest: action.digest };
      },
    });
  });

  afterAll(async () => {
    await rm(workRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('stage accepte l\'extension .skill et l\'audit passe', async () => {
    const staged = await installer.stage({ sourcePath: CONVERTED });
    expect(staged.report.name).toBe('mythos');
    expect(staged.report.installable).toBe(true);
    expect(staged.report.issues).toEqual([]);

    const installed = await installer.install({ quarantineId: staged.quarantineId });
    expect(installed.installed).toBe(true);
    expect(installed.name).toBe('mythos');
    expect(confirmations[0]).toMatchObject({ name: 'skill.install', skillName: 'mythos' });
    expect(confirmations[0].digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('le skill installé se charge : digest vérifié, 3 références lisibles, corps intact', async () => {
    const loader = createSkillLoader({ root: join(workRoot, 'skills') });
    const loaded = await loader.load('mythos');
    expect(loaded.name).toBe('mythos');
    expect(Object.keys(loaded.references).sort()).toEqual([
      'references/output-standards.md',
      'references/reasoning-protocols.md',
      'references/threat-models.md',
    ]);
    expect(loaded.body).toContain('MYTHOS — Frontier Reasoning Mode');
    expect(loaded.body).toContain('Mythos Reasoning Chain');
    expect(loaded.references['references/threat-models.md'].length).toBeGreaterThan(1_000);
  });
});
