import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditSkillPackage } from '../src/skills/skill-auditor.mjs';
import { createSkillInstaller } from '../src/skills/skill-installer.mjs';
import { createSkillLoader } from '../src/skills/skill-loader.mjs';
import { createSkillRegistry } from '../src/skills/skill-registry.mjs';

let temporary;
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = null;
});

describe('reference skills', () => {
  it('are digest-valid, script-free and scoped to their documented channels/capabilities', async () => {
    const expected = {
      'research-summary': { channels: ['local', 'telegram'], capabilities: ['research.web'] },
      'file-analysis': { channels: ['local'], capabilities: ['files.read', 'research.file'] },
      'sandbox-code': { channels: ['local', 'voice'], capabilities: ['sandbox.propose'] },
    };
    for (const [name, scope] of Object.entries(expected)) {
      const report = await auditSkillPackage({ directory: resolve('skills-reference', name) });
      expect(report).toMatchObject({ name, installable: true, scripts: [], channels: scope.channels, capabilities: scope.capabilities });
    }
  });

  // Finding F-03 (audit 2026-07-27) : le skill pianiste était livré avec un manifeste réduit à
  // `name` + `description` → `skill_metadata_fields_invalid`, jamais enregistré (le correctif de
  // résilience du registre évitait le crash de boot mais ne rendait pas le skill utilisable).
  // C'est aussi le PREMIER skill de référence à déclarer un script : il ne peut donc pas être
  // exposé sur telegram (le schéma l'interdit), d'où un cas de test distinct.
  it('le skill pianiste a un manifeste conforme, un digest vérifiable et déclare son script (F-03)', async () => {
    const directory = resolve('skills-reference', 'pianiste-volonte-lumiere');
    const report = await auditSkillPackage({ directory });
    expect(report).toMatchObject({
      name: 'pianiste-volonte-lumiere',
      installable: true,
      scripts: ['scripts/write_piano_midi.py'],
      channels: ['local', 'voice'], // jamais telegram : un skill à script y est interdit
      capabilities: ['conversation.reply_draft', 'sandbox.propose'],
    });

    // Le registre l'expose réellement (c'était le symptôme : pianistRegistered = false).
    const entries = await createSkillRegistry({ root: resolve('skills-reference') }).scan();
    expect(entries.map((entry) => entry.name)).toContain('pianiste-volonte-lumiere');

    // Et le chargement complet passe la vérification de digest (fichiers non altérés).
    const loaded = await createSkillLoader({ root: resolve('skills-reference') }).load('pianiste-volonte-lumiere');
    expect(loaded.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.keys(loaded.references)).toEqual([
      'references/langage-musical.md',
      'references/contrat-midi.md',
    ]);
  });

  it('installs a reference skill only through quarantine and confirmation', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'mina-reference-install-'));
    const quarantineRoot = join(temporary, 'quarantine');
    const skillsRoot = join(temporary, 'skills');
    await Promise.all([mkdir(quarantineRoot), mkdir(skillsRoot)]);
    let id = 0;
    const confirmLocal = vi.fn(async ({ action }) => ({ approved: true, token: `confirm-${++id}`, digest: action.digest }));
    const installer = createSkillInstaller({ quarantineRoot, skillsRoot, confirmLocal, ids: () => `q-${++id}` });
    const staged = await installer.stage({ sourcePath: resolve('skills-reference', 'research-summary') });
    await expect(createSkillLoader({ root: skillsRoot }).load('research-summary')).rejects.toThrow();
    await installer.install({ quarantineId: staged.quarantineId });
    await expect(createSkillLoader({ root: skillsRoot }).load('research-summary')).resolves.toMatchObject({ name: 'research-summary' });
    expect(confirmLocal).toHaveBeenCalledOnce();
  });
});
