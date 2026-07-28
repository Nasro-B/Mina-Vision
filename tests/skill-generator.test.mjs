import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSkillGenerator } from '../src/skills/skill-generator.mjs';
import { createSkillLoader } from '../src/skills/skill-loader.mjs';
import { createSkillRegistry } from '../src/skills/skill-registry.mjs';

let workdir;
let root;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'mina-skill-generator-'));
  root = join(workdir, 'skills-reference');
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

function metadataFor(slug, overrides = {}) {
  return {
    name: slug,
    description: 'Skill de test du générateur sûr.',
    version: '1.0.0',
    triggers: ['test générateur'],
    capabilities: ['conversation.reply_draft'],
    channels: ['local'],
    compatibility: { mina: '>=1.0.0', platforms: ['win32'] },
    entrypoints: { instructions: 'SKILL.md', references: [], scripts: [] },
    budgets: { maxCostMicros: 0, maxDurationMs: 1_000, maxTokens: 100 },
    ...overrides,
  };
}

function generatorWith(confirm, extra = {}) {
  return createSkillGenerator({ root, confirm, workspaceRoot: workdir, ...extra });
}

async function slugsIn(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true })).map((entry) => entry.name).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

describe('skill-generator — structure exacte', () => {
  it('écrit SKILL.md à la racine du slug et rend le skill chargeable par le vrai loader', async () => {
    const generator = generatorWith(() => true);
    const result = await generator.generate({
      slug: 'skill-de-test',
      metadata: metadataFor('skill-de-test', {
        entrypoints: { instructions: 'SKILL.md', references: ['references/notes.md'], scripts: [] },
      }),
      body: '# Skill de test\n\nContenu.\n',
      references: [{ path: 'references/notes.md', content: '# Notes\n' }],
    });

    expect(result.action).toBe('create');
    expect(result.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(await slugsIn(root)).toEqual(['skill-de-test']);
    expect(await slugsIn(join(root, 'skill-de-test'))).toEqual(['SKILL.md', 'references']);

    // Le loader recalcule le condensat et refuse tout écart : sa réussite prouve que le digest
    // scellé décrit bien les octets publiés.
    const loaded = await createSkillLoader({ root }).load('skill-de-test');
    expect(loaded.digest).toBe(result.digest);
    expect(loaded.references['references/notes.md']).toBe('# Notes\n');
  });

  it("refuse l'imbrication qui a tué le démarrage du 2026-07-27", async () => {
    const generator = generatorWith(() => true);
    // Reproduction exacte de l'incident : le skill rangeait son propre contenu sous un dossier
    // portant son nom, produisant `pianiste-…/pianiste-…/SKILL.md`.
    await expect(generator.generate({
      slug: 'pianiste-volonte-lumiere',
      metadata: metadataFor('pianiste-volonte-lumiere', {
        entrypoints: {
          instructions: 'SKILL.md',
          references: ['pianiste-volonte-lumiere/references/langage.md'],
          scripts: [],
        },
      }),
      references: [{ path: 'pianiste-volonte-lumiere/references/langage.md', content: '# Langage\n' }],
    })).rejects.toThrow(/skill_nested_slug_forbidden/u);

    expect(await slugsIn(root)).toEqual([]);
  });

  it('refuse un second SKILL.md en profondeur (racine du skill ambiguë)', async () => {
    const generator = generatorWith(() => true);
    await expect(generator.generate({
      slug: 'skill-de-test',
      metadata: metadataFor('skill-de-test', {
        entrypoints: { instructions: 'SKILL.md', references: ['interne/SKILL.md'], scripts: [] },
      }),
      references: [{ path: 'interne/SKILL.md', content: '---\n---\n' }],
    })).rejects.toThrow(/skill_nested_document_forbidden/u);
    expect(await slugsIn(root)).toEqual([]);
  });

  it('refuse un manifeste qui ment sur son contenu, dans les deux sens', async () => {
    const generator = generatorWith(() => true);
    await expect(generator.generate({
      slug: 'skill-de-test',
      metadata: metadataFor('skill-de-test', {
        entrypoints: { instructions: 'SKILL.md', references: ['references/absent.md'], scripts: [] },
      }),
    })).rejects.toThrow(/skill_declared_reference_missing:references\/absent\.md/u);

    await expect(generator.generate({
      slug: 'skill-de-test',
      metadata: metadataFor('skill-de-test'),
      references: [{ path: 'references/orphelin.md', content: '# Orphelin\n' }],
    })).rejects.toThrow(/skill_undeclared_file:references\/orphelin\.md/u);

    expect(await slugsIn(root)).toEqual([]);
  });

  it('refuse un slug invalide et un nom divergent du dossier', async () => {
    const generator = generatorWith(() => true);
    await expect(generator.generate({ slug: '../evasion', metadata: metadataFor('evasion') }))
      .rejects.toThrow(/skill_slug_invalid/u);
    await expect(generator.generate({ slug: 'skill-de-test', metadata: metadataFor('autre-nom') }))
      .rejects.toThrow(/skill_name_slug_mismatch/u);
  });
});

describe('skill-generator — auto-validation avant écriture', () => {
  it('un manifeste refusé par le schéma ne laisse RIEN dans skills-reference', async () => {
    const generator = generatorWith(() => true);
    // `sandbox.execute` est une capacité connue, mais `channels: ['telegram']` avec un script
    // déclaré est interdit par le schéma (skill_telegram_scope_forbidden).
    await expect(generator.generate({
      slug: 'skill-de-test',
      metadata: metadataFor('skill-de-test', {
        channels: ['telegram'],
        capabilities: ['sandbox.execute'],
        entrypoints: { instructions: 'SKILL.md', references: [], scripts: ['scripts/run.py'] },
      }),
      scripts: [{ path: 'scripts/run.py', content: 'print("x")\n' }],
    })).rejects.toThrow(/skill_telegram_scope_forbidden/u);

    expect(await slugsIn(root)).toEqual([]);
    expect(await slugsIn(workdir)).toEqual([]);
  });

  it('la validation passe par le VRAI registre : un skill généré est listé par scan()', async () => {
    await generatorWith(() => true).generate({
      slug: 'skill-de-test',
      metadata: metadataFor('skill-de-test'),
      body: '# Corps\n',
    });
    const listed = await createSkillRegistry({ root }).scan();
    expect(listed.map((entry) => entry.name)).toEqual(['skill-de-test']);
    expect(listed[0].digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('ne laisse aucun dossier de préparation derrière lui, même en cas de refus', async () => {
    await expect(generatorWith(() => false).generate({
      slug: 'skill-de-test',
      metadata: metadataFor('skill-de-test'),
    })).rejects.toThrow(/skill_generation_not_confirmed/u);

    const residus = (await slugsIn(workdir)).filter((name) => name.startsWith('.mina-skill-staging-'));
    expect(residus).toEqual([]);
  });
});

describe('skill-generator — confirmation locale obligatoire', () => {
  it('sans fonction de confirmation, le générateur refuse de se construire', () => {
    expect(() => createSkillGenerator({ root })).toThrow(/skill_confirmation_required/u);
    expect(() => createSkillGenerator({ confirm: () => true })).toThrow(/skill_root_required/u);
  });

  it('un refus (ou une réponse ambiguë) n’écrit rien', async () => {
    for (const reponse of [false, undefined, null, 'oui', 1]) {
      await expect(generatorWith(() => reponse).generate({
        slug: 'skill-de-test',
        metadata: metadataFor('skill-de-test'),
      })).rejects.toThrow(/skill_generation_not_confirmed/u);
    }
    expect(await slugsIn(root)).toEqual([]);
  });

  it('la confirmation reçoit le condensat réel et la liste exacte des fichiers', async () => {
    const vues = [];
    await generatorWith((demande) => { vues.push(demande); return true; }).generate({
      slug: 'skill-de-test',
      metadata: metadataFor('skill-de-test', {
        entrypoints: { instructions: 'SKILL.md', references: [], scripts: ['scripts/run.py'] },
        capabilities: ['sandbox.propose'],
      }),
      scripts: [{ path: 'scripts/run.py', content: 'print("bonjour")\n' }],
    });

    expect(vues).toHaveLength(1);
    expect(vues[0].action).toBe('create');
    expect(vues[0].slug).toBe('skill-de-test');
    expect(vues[0].capabilities).toEqual(['sandbox.propose']);
    expect(vues[0].files.map((file) => file.path).sort()).toEqual(['SKILL.md', 'scripts/run.py']);
    // Le condensat montré à l'humain est celui qui sera publié, pas une valeur provisoire.
    const published = await createSkillLoader({ root }).load('skill-de-test');
    expect(vues[0].digest).toBe(published.digest);
  });
});

describe('skill-generator — remplacement', () => {
  it('une mise à jour est annoncée comme telle et remplace le contenu', async () => {
    const actions = [];
    const generator = generatorWith((demande) => { actions.push(demande.action); return true; });
    const base = { slug: 'skill-de-test', metadata: metadataFor('skill-de-test') };

    const premier = await generator.generate({ ...base, body: '# Version 1\n' });
    const second = await generator.generate({
      ...base,
      metadata: metadataFor('skill-de-test', { version: '1.1.0' }),
      body: '# Version 2\n',
    });

    expect(actions).toEqual(['create', 'update']);
    expect(second.digest).not.toBe(premier.digest);
    const document = await readFile(join(root, 'skill-de-test', 'SKILL.md'), 'utf8');
    expect(document).toContain('# Version 2');
    expect(document).toContain('version: 1.1.0');
    expect(await slugsIn(root)).toEqual(['skill-de-test']);
  });

  it('un refus de mise à jour laisse la version installée intacte', async () => {
    let autorise = true;
    const generator = generatorWith(() => autorise);
    await generator.generate({
      slug: 'skill-de-test',
      metadata: metadataFor('skill-de-test'),
      body: '# Version 1\n',
    });

    autorise = false;
    await expect(generator.generate({
      slug: 'skill-de-test',
      metadata: metadataFor('skill-de-test', { version: '2.0.0' }),
      body: '# Version 2\n',
    })).rejects.toThrow(/skill_generation_not_confirmed/u);

    const document = await readFile(join(root, 'skill-de-test', 'SKILL.md'), 'utf8');
    expect(document).toContain('# Version 1');
    expect(document).toContain('version: 1.0.0');
  });
});

describe('skill-generator — le skill produit ne peut pas tuer le démarrage', () => {
  it('un dossier imbriqué écrit à la main reste ignoré, le skill généré reste chargé', async () => {
    await generatorWith(() => true).generate({
      slug: 'skill-de-test',
      metadata: metadataFor('skill-de-test'),
    });

    // Ce que le générateur empêche d'écrire peut encore arriver par une autre voie (copie
    // manuelle) : on recrée ici l'imbrication du 2026-07-27 pour vérifier les DEUX barrières —
    // celle de l'écriture (au-dessus) et celle de la lecture (le registre tolérant du 1377861).
    await mkdir(join(root, 'skill-casse', 'skill-casse'), { recursive: true });
    await writeFile(join(root, 'skill-casse', 'skill-casse', 'SKILL.md'), '---\nname: skill-casse\n---\n', 'utf8');

    const listed = await createSkillRegistry({ root }).scan();
    expect(listed.map((entry) => entry.name)).toEqual(['skill-de-test']);
  });
});
