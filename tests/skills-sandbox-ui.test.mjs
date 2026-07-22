import { describe, expect, it, vi } from 'vitest';
import { createSkillsSandboxController } from '../src/ui/pages/skills-sandbox-controller.mjs';
import { registerSkillsSandboxIpc } from '../src/ui/ipc/skills-sandbox-ipc.mjs';
import { createSandboxUiManager } from '../src/sandbox/sandbox-ui-manager.mjs';

function harness(overrides = {}) {
  const dependencies = {
    loadInstructions: vi.fn(async () => ({ version: 3, digest: `sha256:${'a'.repeat(64)}` })),
    skillRegistry: {
      scan: vi.fn(async () => [{
        name: 'research-summary', version: '1.0.0', digest: `sha256:${'b'.repeat(64)}`,
        capabilities: ['web.read'], channels: ['local'],
      }]),
    },
    bundledSkillRegistry: {
      scan: vi.fn(async () => [{
        name: 'file-analysis', version: '1.0.0', digest: `sha256:${'c'.repeat(64)}`,
        capabilities: ['files.read'], channels: ['local'],
      }]),
    },
    skillInstaller: {
      stage: vi.fn(async ({ sourcePath }) => ({ quarantineId: 'q-1', sourcePath, report: { installable: true } })),
      install: vi.fn(async ({ quarantineId }) => ({ installed: true, quarantineId, name: 'research-summary' })),
    },
    selectSkillPackage: vi.fn(async () => 'C:\\skills\\research-summary.zip'),
    sandboxManager: {
      status: vi.fn(async () => ({ available: false, reason: 'virtualization_unavailable', remediation: 'Activer la virtualisation et Windows Sandbox.' })),
      list: vi.fn(() => ({ proposals: [{ proposalId: 'proposal-1', requestedPermissions: ['sandbox.execute'] }], jobs: [], artifacts: [] })),
      executeProposal: vi.fn(async (proposalId) => ({ jobId: 'job-1', proposalId })),
      cancel: vi.fn(async (jobId) => ({ canceled: true, jobId })),
      importArtifact: vi.fn(async ({ jobId, artifactId }) => ({ imported: true, jobId, artifactId })),
    },
    ...overrides,
  };
  return { dependencies, controller: createSkillsSandboxController(dependencies) };
}

describe('Skills and sandbox UI boundary', () => {
  it('returns the MINA digest, installed skills and fail-closed sandbox remediation', async () => {
    const { controller } = harness();

    await expect(controller.status()).resolves.toEqual({
      instructions: { version: 3, digest: `sha256:${'a'.repeat(64)}` },
      installedSkills: [{
        name: 'research-summary', version: '1.0.0', digest: `sha256:${'b'.repeat(64)}`,
        capabilities: ['web.read'], channels: ['local'],
      }],
      bundledSkills: [{
        name: 'file-analysis', version: '1.0.0', digest: `sha256:${'c'.repeat(64)}`,
        capabilities: ['files.read'], channels: ['local'],
      }],
      sandbox: { available: false, reason: 'virtualization_unavailable', remediation: 'Activer la virtualisation et Windows Sandbox.' },
      proposals: [{ proposalId: 'proposal-1', requestedPermissions: ['sandbox.execute'] }],
      jobs: [],
      artifacts: [],
    });
  });

  it('selects skill packages in main, stages them, then installs by quarantine ID only', async () => {
    const { controller, dependencies } = harness();

    await expect(controller.chooseAndStageSkill()).resolves.toMatchObject({ quarantineId: 'q-1' });
    expect(dependencies.skillInstaller.stage).toHaveBeenCalledWith({ sourcePath: 'C:\\skills\\research-summary.zip' });
    await expect(controller.installSkill({ quarantineId: 'q-1' })).resolves.toMatchObject({ installed: true });
    expect(dependencies.skillInstaller.install).toHaveBeenCalledWith({ quarantineId: 'q-1' });
    expect(dependencies.skillRegistry.scan).toHaveBeenCalledTimes(1);
  });

  it('executes and cancels only opaque validated identifiers', async () => {
    const { controller, dependencies } = harness();

    await controller.executeSandbox({ proposalId: 'proposal-1' });
    await controller.cancelSandbox({ jobId: 'job-1' });
    await controller.importArtifact({ jobId: 'job-1', artifactId: 'artifact-1' });
    expect(dependencies.sandboxManager.executeProposal).toHaveBeenCalledWith('proposal-1');
    expect(dependencies.sandboxManager.cancel).toHaveBeenCalledWith('job-1');
    expect(dependencies.sandboxManager.importArtifact).toHaveBeenCalledWith({ jobId: 'job-1', artifactId: 'artifact-1' });
    await expect(controller.executeSandbox({ proposalId: '../unsafe', job: { language: 'python' } }))
      .rejects.toThrow('sandbox_ui_request_invalid');
  });

  it('registers an exact IPC allowlist without accepting paths or job bodies', async () => {
    const handlers = new Map();
    const ipcMain = { handle: vi.fn((channel, handler) => handlers.set(channel, handler)) };
    const { controller } = harness();
    registerSkillsSandboxIpc({ ipcMain, controller });

    expect([...handlers.keys()]).toEqual([
      'mina:skills-sandbox:status',
      'mina:skills:choose-stage',
      'mina:skills:install',
      'mina:sandbox:execute',
      'mina:sandbox:cancel',
      'mina:sandbox:import-artifact',
    ]);
    await expect(handlers.get('mina:skills:install')({}, { quarantineId: 'q-1', sourcePath: 'C:\\unsafe' }))
      .rejects.toThrow('skills_ui_request_invalid');
    await handlers.get('mina:sandbox:execute')({}, { proposalId: 'proposal-1' });
  });
});

describe('sandbox proposal manager', () => {
  it('revalidates a digest and confirms it in main before executing', async () => {
    const digest = `sha256:${'c'.repeat(64)}`;
    const runner = { execute: vi.fn(async () => ({ jobId: 'job-1', status: 'running' })), cancel: vi.fn(), importArtifact: vi.fn() };
    const manager = createSandboxUiManager({
      backend: { detect: vi.fn(async () => ({ available: true, reason: null })) },
      revalidateProposal: vi.fn(async (proposal) => ({ ...proposal, digest })),
      confirmLocal: vi.fn(async ({ action }) => ({ approved: true, digest: action.digest, token: 'one-shot' })),
      runner,
    });
    manager.registerProposal({ proposalId: 'proposal-1', digest, summary: 'Exécuter main.py', requestedPermissions: ['sandbox.execute'] });

    await expect(manager.executeProposal('proposal-1')).resolves.toMatchObject({ jobId: 'job-1' });
    expect(runner.execute).toHaveBeenCalledWith(expect.objectContaining({ digest, confirmationToken: 'one-shot' }));
  });

  it('blocks execution while Windows Sandbox is unavailable', async () => {
    const manager = createSandboxUiManager({
      backend: { detect: vi.fn(async () => ({ available: false, reason: 'virtualization_unavailable' })) },
      revalidateProposal: vi.fn(), confirmLocal: vi.fn(),
      runner: { execute: vi.fn(), cancel: vi.fn(), importArtifact: vi.fn() },
    });
    manager.registerProposal({
      proposalId: 'proposal-1', digest: `sha256:${'d'.repeat(64)}`,
      summary: 'Exécuter main.py', requestedPermissions: ['sandbox.execute'],
    });

    await expect(manager.executeProposal('proposal-1')).rejects.toThrow('sandbox_unavailable:virtualization_unavailable');
  });
});
