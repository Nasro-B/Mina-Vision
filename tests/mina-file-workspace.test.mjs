import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMinaFileWorkspace } from '../src/files/mina-file-workspace.mjs';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryWorkspace() {
  const temporary = await mkdtemp(join(tmpdir(), 'mina-file-workspace-'));
  temporaryRoots.push(temporary);
  const root = join(temporary, 'Mina Vision');
  return { root, workspace: createMinaFileWorkspace({ root }) };
}

describe('Mina Vision file workspace', () => {
  it('creates the parent before Sandbox instead of racing nested Windows mkdir calls', async () => {
    const root = join(tmpdir(), 'Mina Vision ordered');
    const calls = [];
    let releaseParent;
    const parentReady = new Promise((resolve) => { releaseParent = resolve; });
    const mkdirDirectory = vi.fn(async (directory) => {
      calls.push(directory);
      if (calls.length === 1) await parentReady;
    });
    const workspace = createMinaFileWorkspace({ root, mkdirDirectory });

    const ensuring = workspace.ensure();
    await Promise.resolve();
    expect(calls).toEqual([root]);
    releaseParent();
    await ensuring;
    expect(calls).toEqual([root, join(root, 'Sandbox')]);
  });

  it('creates the personal output root and Sandbox directory before use', async () => {
    const { root, workspace } = await temporaryWorkspace();

    await workspace.ensure();

    await expect(stat(root)).resolves.toMatchObject({});
    await expect(stat(join(root, 'Sandbox'))).resolves.toMatchObject({});
  });

  it('grounds a named desktop file creation in the personal output root', async () => {
    const { root, workspace } = await temporaryWorkspace();
    await workspace.ensure();

    const prepared = await workspace.prepareMission({
      environment: 'desktop',
      goal: 'Crée le fichier erreurs_techniques.md',
    });

    expect(prepared.expectedPath).toBe(join(root, 'erreurs_techniques.md'));
    expect(prepared.mission.goal).toContain(join(root, 'erreurs_techniques.md'));
    expect(prepared.mission.goal).toContain('Ne déclare pas la mission terminée');
  });

  it('rejects a completed mission when the requested file was not created on disk', async () => {
    const { workspace } = await temporaryWorkspace();
    await workspace.ensure();
    const prepared = await workspace.prepareMission({
      environment: 'desktop',
      goal: 'Crée le fichier erreurs_techniques.md',
    });

    await expect(workspace.verifyMission({ status: 'completed', result: 'créé' }, prepared))
      .rejects.toThrow('file_creation_not_verified');
  });

  it('accepts completion only after the requested file appears with real bytes', async () => {
    const { workspace } = await temporaryWorkspace();
    await workspace.ensure();
    const prepared = await workspace.prepareMission({
      environment: 'desktop',
      goal: 'Crée le fichier erreurs_techniques.md',
    });
    await writeFile(prepared.expectedPath, '# Erreurs techniques\n', 'utf8');

    const result = await workspace.verifyMission({ status: 'completed', result: 'créé' }, prepared);

    expect(result).toMatchObject({ status: 'completed' });
    expect(result.fileEvidence).toMatchObject({ path: prepared.expectedPath, bytes: 21 });
    await expect(readFile(prepared.expectedPath, 'utf8')).resolves.toBe('# Erreurs techniques\n');
  });
});
