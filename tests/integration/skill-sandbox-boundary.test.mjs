import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeSkillManifest } from '../../src/skills/skill-loader.mjs';
import { createSkillInstaller } from '../../src/skills/skill-installer.mjs';
import { createSkillRegistry } from '../../src/skills/skill-registry.mjs';
import { createWindowsSandboxBackend } from '../../src/sandbox/windows-sandbox.mjs';
import { parseSandboxJob, createSandboxSourceDigest } from '../../src/sandbox/job-schema.mjs';

let root;
let sourceRoot;
let quarantineRoot;
let skillsRoot;
let id;

function skillDocument({ license = '' } = {}) {
  return `---
name: sandbox-code
description: Propose une exécution isolée et bornée.
version: 1.0.0
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
digest: sha256:manifest-placeholder
---

# Sandbox code

Construit uniquement une proposition de job.${license}
`;
}

async function createSource() {
  const directory = join(sourceRoot, 'sandbox-code');
  await mkdir(join(directory, 'scripts'), { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), skillDocument());
  await writeFile(join(directory, 'scripts', 'main.py'), 'print("proposed, never executed here")\n');
  const manifest = await computeSkillManifest({ directory });
  const current = await readFile(join(directory, 'SKILL.md'), 'utf8');
  await writeFile(join(directory, 'SKILL.md'), current.replace('sha256:manifest-placeholder', manifest.digest));
  return directory;
}

function windowsSandboxUnavailable() {
  return createWindowsSandboxBackend({
    platform: 'win32',
    probes: {
      feature: vi.fn(async () => false),
      executable: vi.fn(async () => true),
      virtualization: vi.fn(async () => true),
      ntfs: vi.fn(async () => true),
      runtimes: vi.fn(async () => true),
    },
    launcher: vi.fn(async () => { throw new Error('should_never_launch'); }),
    writeWsb: vi.fn(async () => { throw new Error('should_never_write_wsb'); }),
    sandboxExecutable: 'C:\\Windows\\System32\\WindowsSandbox.exe',
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mina-skill-sandbox-boundary-'));
  sourceRoot = join(root, 'sources');
  quarantineRoot = join(root, 'quarantine');
  skillsRoot = join(root, 'skills');
  id = 0;
  await Promise.all([mkdir(sourceRoot), mkdir(quarantineRoot), mkdir(skillsRoot)]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('v2 integration: even a legitimately-installed skill never executes a sandbox job when Windows Sandbox is absent', () => {
  it('a real quarantined-then-installed skill proposing a sandbox job is refused by the real backend fail-closed, never launched', async () => {
    const sourcePath = await createSource();
    const installer = createSkillInstaller({
      quarantineRoot, skillsRoot,
      confirmLocal: vi.fn(async ({ action }) => ({ approved: true, token: `confirm-${action.digest}`, digest: action.digest })),
      ids: () => `q-${++id}`,
    });
    const staged = await installer.stage({ sourcePath });
    expect(staged.report.installable).toBe(true);
    const installed = await installer.install({ quarantineId: staged.quarantineId });
    expect(installed.installed).toBe(true);
    expect(await createSkillRegistry({ root: skillsRoot }).scan()).toHaveLength(1);

    const sandbox = windowsSandboxUnavailable();
    const availability = await sandbox.detect();
    expect(availability).toEqual({ available: false, reason: 'windows_sandbox_feature_disabled' });

    await expect(sandbox.execute({
      jobId: 'job-1', job: { limits: { wallMs: 30_000 } },
      workspace: { sourcePath: 'C:\\jobs\\1\\src', outPath: 'C:\\jobs\\1\\out', bootstrapPath: 'bootstrap.ps1' },
    })).rejects.toThrow('sandbox_unavailable:windows_sandbox_feature_disabled');
  });

  it('a sandbox job proposed from Telegram is rejected before ever reaching the sandbox backend', () => {
    expect(() => parseSandboxJob({
      language: 'python',
      sourceFiles: [{ path: 'main.py', digest: `sha256:${'a'.repeat(64)}`, mode: 'read-only' }],
      entrypoint: 'main.py', args: [], profile: 'small', limits: { wallMs: 30_000, memoryMiB: 256, outputBytes: 1024 }, network: false, exports: [],
    }, { channel: 'telegram', explicitExecution: true })).toThrow('sandbox_channel_forbidden:telegram');
  });

  it('a well-behaved local job request is accepted by parseSandboxJob but still fail-closed at the real sandbox backend', () => {
    const sourceFiles = [{ path: 'main.py', digest: `sha256:${'a'.repeat(64)}`, mode: 'read-only' }];
    const job = parseSandboxJob({
      language: 'python', sourceFiles, entrypoint: 'main.py', args: [], profile: 'small',
      limits: { wallMs: 30_000, memoryMiB: 256, outputBytes: 1024 }, network: false, exports: [],
    }, {
      channel: 'local', explicitExecution: true,
      sourceConfirmation: { approved: true, token: 'tok-1', digest: createSandboxSourceDigest(sourceFiles) },
    });
    expect(job.language).toBe('python');
  });
});
