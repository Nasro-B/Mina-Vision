import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeSkillManifest, createSkillLoader } from '../src/skills/skill-loader.mjs';
import { createSkillRegistry } from '../src/skills/skill-registry.mjs';
import { createSkillInstaller } from '../src/skills/skill-installer.mjs';

let root;
let sourceRoot;
let quarantineRoot;
let skillsRoot;
let id;

function skillDocument({ version = '1.0.0', license = '', digest = 'sha256:manifest-placeholder' } = {}) {
  return `---
name: sandbox-code
description: Propose une exécution isolée et bornée.
version: ${version}
triggers:
  - exécute ce code
capabilities:
  - sandbox.propose
channels:
  - local
compatibility:
  mina: ">=3"
  platforms:
    - win32
entrypoints:
  instructions: SKILL.md
  references: []
  scripts:
    - scripts/main.py
budgets:
  maxDurationMs: 30000
  maxCostMicros: 1000
  maxTokens: 4096
digest: ${digest}
---

# Sandbox code

Construit uniquement une proposition de job.${license}
`;
}

async function createSource(name = 'source', options = {}) {
  const directory = join(sourceRoot, name);
  await mkdir(join(directory, 'scripts'), { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), skillDocument(options));
  await writeFile(join(directory, 'scripts', 'main.py'), 'print("ok")\n');
  if (options.licenseText) await writeFile(join(directory, 'LICENSE'), options.licenseText);
  const manifest = await computeSkillManifest({ directory });
  const current = await readFile(join(directory, 'SKILL.md'), 'utf8');
  await writeFile(join(directory, 'SKILL.md'), current.replace('sha256:manifest-placeholder', manifest.digest));
  return directory;
}

function installer(confirmLocal = vi.fn(async ({ action }) => ({
  approved: true, token: `confirm-${action.digest}-${id}`, digest: action.digest,
}))) {
  return createSkillInstaller({
    quarantineRoot,
    skillsRoot,
    confirmLocal,
    ids: () => `q-${++id}`,
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mina-installer-'));
  sourceRoot = join(root, 'sources');
  quarantineRoot = join(root, 'quarantine');
  skillsRoot = join(root, 'skills');
  id = 0;
  await Promise.all([mkdir(sourceRoot), mkdir(quarantineRoot), mkdir(skillsRoot)]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('quarantined skill installer', () => {
  it('stages, audits, confirms and atomically installs a local folder', async () => {
    const sourcePath = await createSource();
    const service = installer();
    const staged = await service.stage({ sourcePath });
    expect(staged.report).toMatchObject({
      name: 'sandbox-code', version: '1.0.0', installable: true,
      scripts: ['scripts/main.py'], capabilities: ['sandbox.propose'], licenseStatus: 'unknown',
    });

    const installed = await service.install({ quarantineId: staged.quarantineId });
    expect(installed).toMatchObject({ installed: true, name: 'sandbox-code', version: '1.0.0', rollbackId: null });
    expect(await createSkillRegistry({ root: skillsRoot }).scan()).toHaveLength(1);
    await expect(createSkillLoader({ root: skillsRoot }).load('sandbox-code'))
      .resolves.toMatchObject({ name: 'sandbox-code', version: '1.0.0' });
  });

  it('inspects ZIP entries before extraction and rejects traversal or nested archives', async () => {
    const traversal = join(sourceRoot, 'traversal.zip');
    const zip = new AdmZip();
    zip.addFile('aa/escape.txt', Buffer.from('escape'));
    zip.addFile('SKILL.md', Buffer.from('invalid'));
    const archive = zip.toBuffer();
    const safeName = Buffer.from('aa/escape.txt');
    const hostileName = Buffer.from('../escape.txt');
    for (let offset = archive.indexOf(safeName); offset >= 0; offset = archive.indexOf(safeName, offset + hostileName.length)) {
      hostileName.copy(archive, offset);
    }
    await writeFile(traversal, archive);
    await expect(installer().stage({ sourcePath: traversal })).rejects.toThrow('skill_archive_path_invalid');

    const nested = join(sourceRoot, 'nested.zip');
    const nestedZip = new AdmZip();
    nestedZip.addFile('payload.zip', Buffer.from('PK'));
    nestedZip.writeZip(nested);
    await expect(installer().stage({ sourcePath: nested })).rejects.toThrow('skill_nested_archive_forbidden');
  });

  it('rejects reparse points, incompatible AGPL packages and refused confirmations', async () => {
    const sourcePath = await createSource('linked-source');
    await symlink(join(sourcePath, 'scripts'), join(sourcePath, 'linked'), 'junction');
    await expect(installer().stage({ sourcePath })).rejects.toThrow('skill_reparse_point_forbidden');

    const agpl = await createSource('agpl', { licenseText: 'GNU AFFERO GENERAL PUBLIC LICENSE Version 3' });
    const service = installer();
    const staged = await service.stage({ sourcePath: agpl });
    expect(staged.report).toMatchObject({ installable: false, licenseStatus: 'incompatible_agpl' });
    await expect(service.install({ quarantineId: staged.quarantineId })).rejects.toThrow('skill_license_incompatible');

    const refusedSource = await createSource('refused');
    const refused = installer(vi.fn(async () => ({ approved: false })));
    const refusedStage = await refused.stage({ sourcePath: refusedSource });
    await expect(refused.install({ quarantineId: refusedStage.quarantineId })).rejects.toThrow('skill_install_refused');
  });

  it('keeps the previous version for an explicit rollback after an update', async () => {
    const service = installer();
    const first = await service.stage({ sourcePath: await createSource('v1', { version: '1.0.0' }) });
    await service.install({ quarantineId: first.quarantineId });
    const second = await service.stage({ sourcePath: await createSource('v2', { version: '2.0.0' }) });
    const updated = await service.install({ quarantineId: second.quarantineId });
    expect(updated.rollbackId).toMatch(/^rollback-/u);
    await expect(createSkillLoader({ root: skillsRoot }).load('sandbox-code')).resolves.toMatchObject({ version: '2.0.0' });

    const rolledBack = await service.rollback({ name: 'sandbox-code', rollbackId: updated.rollbackId });
    expect(rolledBack).toMatchObject({ rolledBack: true, name: 'sandbox-code', version: '1.0.0' });
    await expect(createSkillLoader({ root: skillsRoot }).load('sandbox-code')).resolves.toMatchObject({ version: '1.0.0' });
  });
});
