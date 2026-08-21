import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { composeGenesis } from '../src/code/genesis/compose-genesis.mjs';

const ROOT = path.resolve('/projets');
function fakeFs() {
  const writes = {};
  return { writes, exists: vi.fn(async () => false), isEmptyDir: vi.fn(async () => true), mkdirp: vi.fn(async () => {}), writeFileAtomic: vi.fn(async (p, c) => { writes[p] = c; }) };
}
const deps = () => ({ fs: fakeFs(), runCommand: vi.fn(async () => ({ code: 0 })), allowedRoots: [ROOT] });

describe('compose-genesis (genèse T1.4)', () => {
  it('prepare : brief normalisé + stack DEMANDÉE si connue + description, sans écrire', () => {
    const g = composeGenesis(deps());
    const plan = g.prepare({ name: 'api-notes', type: 'api', stack: 'node-fastify', targetDir: path.join(ROOT, 'api-notes') });
    expect(plan.brief.name).toBe('api-notes');
    expect(plan.stack.id).toBe('node-fastify');
    expect(plan.stackResolution.explicit).toBe(true);
    expect(plan.description).toContain('« api-notes »');
  });

  it('prepare : stack absente/inconnue → la plus proche, jamais inventée', () => {
    const g = composeGenesis(deps());
    const plan = g.prepare({ name: 'mon-site', type: 'web', targetDir: path.join(ROOT, 'mon-site') });
    expect(plan.stack.id).toBe('vite-react'); // « web » → plus proche
    expect(plan.stackResolution.explicit).toBe(false);
  });

  it('create : écrit + scaffolde le projet, renvoie ready + next step (code-orchestrator)', async () => {
    const d = deps();
    const g = composeGenesis(d);
    const result = await g.create({ name: 'cli-tool', type: 'cli', stack: 'node-cli', targetDir: path.join(ROOT, 'cli-tool') });
    expect(result).toMatchObject({ ready: true, created: true, stackId: 'node-cli' });
    expect(result.nextStep).toMatch(/code-orchestrator/);
    expect(Object.keys(d.fs.writes).some((p) => p.endsWith('package.json'))).toBe(true);
  });

  it('create : refuse une cible hors racine (via project-brief)', async () => {
    const g = composeGenesis(deps());
    await expect(g.create({ name: 'evil', targetDir: '/etc/x' })).rejects.toThrow('outside_roots');
  });
});
