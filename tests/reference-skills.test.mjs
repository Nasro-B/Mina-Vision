import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditSkillPackage } from '../src/skills/skill-auditor.mjs';
import { createSkillInstaller } from '../src/skills/skill-installer.mjs';
import { createSkillLoader } from '../src/skills/skill-loader.mjs';

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
