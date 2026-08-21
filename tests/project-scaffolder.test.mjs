import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createProjectScaffolder } from '../src/code/genesis/project-scaffolder.mjs';
import { getStack } from '../src/code/genesis/stack-catalog.mjs';

function fakeFs({ exists = false, empty = true } = {}) {
  const writes = {};
  return {
    writes,
    exists: vi.fn(async () => exists),
    isEmptyDir: vi.fn(async () => empty),
    mkdirp: vi.fn(async () => {}),
    writeFileAtomic: vi.fn(async (p, content) => { writes[p] = content; }),
  };
}

const brief = { targetDir: path.resolve('/projets/api-notes') };
const stack = getStack('node-cli');

describe('project-scaffolder (genèse T1.3)', () => {
  it('exige fs + runCommand', () => {
    expect(() => createProjectScaffolder({ fs: {}, runCommand: () => {} })).toThrow('dependencies_required');
  });

  it('écrit tout le squelette, git init/commit, npm install, premier test VERT → ready', async () => {
    const fs = fakeFs();
    const runCommand = vi.fn(async () => ({ code: 0 })); // git/npm/test tous verts
    const sc = createProjectScaffolder({ fs, runCommand });
    const result = await sc.scaffold({ brief, stack });
    expect(result).toMatchObject({ ready: true, created: true, testPassed: true, gitCommitted: true, installOk: true });
    // les fichiers du squelette ont bien été écrits
    expect(Object.keys(fs.writes).some((p) => p.endsWith('package.json'))).toBe(true);
    expect(Object.keys(fs.writes).some((p) => p.includes('index.test.mjs'))).toBe(true);
    // ordre : git init AVANT commit ; npm install et test appelés
    const calls = runCommand.mock.calls.map((c) => `${c[0].command} ${c[0].args.join(' ')}`);
    expect(calls).toEqual(expect.arrayContaining(['git init', 'npm install', 'npm test']));
  });

  it('HONNÊTETÉ : premier test ROUGE → ready:false (jamais « créé » sans preuve verte)', async () => {
    const runCommand = vi.fn(async ({ args }) => ({ code: args.join(' ') === 'test' ? 1 : 0 }));
    const sc = createProjectScaffolder({ fs: fakeFs(), runCommand });
    const result = await sc.scaffold({ brief, stack });
    expect(result).toMatchObject({ ready: false, testPassed: false, created: true });
  });

  it('dossier NON vide + confirmation refusée → rien écrit', async () => {
    const fs = fakeFs({ exists: true, empty: false });
    const sc = createProjectScaffolder({ fs, runCommand: vi.fn(async () => ({ code: 0 })), confirm: async () => false });
    const result = await sc.scaffold({ brief, stack });
    expect(result).toMatchObject({ created: false, reason: 'target_not_empty_refused' });
    expect(fs.writeFileAtomic).not.toHaveBeenCalled();
  });

  it('dossier NON vide + confirmation acceptée → écrit', async () => {
    const fs = fakeFs({ exists: true, empty: false });
    const sc = createProjectScaffolder({ fs, runCommand: vi.fn(async () => ({ code: 0 })), confirm: async () => true });
    const result = await sc.scaffold({ brief, stack });
    expect(result.created).toBe(true);
    expect(fs.writeFileAtomic).toHaveBeenCalled();
  });
});
