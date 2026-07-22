import { describe, expect, it, vi } from 'vitest';
import { createDefaultWindowsSandboxProbes, createWindowsSandboxBackend } from '../src/sandbox/windows-sandbox.mjs';

function harness(overrides = {}) {
  const launcher = vi.fn(async () => ({ exitCode: 0, receipt: { status: 'completed', signature: 'valid' } }));
  const probes = {
    feature: vi.fn(async () => true),
    executable: vi.fn(async () => true),
    virtualization: vi.fn(async () => true),
    ntfs: vi.fn(async () => true),
    runtimes: vi.fn(async () => true),
    ...overrides.probes,
  };
  const backend = createWindowsSandboxBackend({
    platform: 'win32',
    probes,
    launcher,
    writeWsb: vi.fn(async () => 'C:\\MinaJobs\\job-1\\job.wsb'),
    sandboxExecutable: 'C:\\Windows\\System32\\WindowsSandbox.exe',
    ...overrides,
    probes,
  });
  return { backend, probes, launcher };
}

const execution = Object.freeze({
  jobId: 'job-1',
  job: { limits: { wallMs: 30_000 } },
  workspace: {
    sourcePath: 'C:\\MinaJobs\\job-1\\src',
    outPath: 'C:\\MinaJobs\\job-1\\out',
    bootstrapPath: 'C:\\MinaRuntime\\bootstrap',
  },
  forbiddenRoots: ['C:\\Serveurs\\Mina Vision', 'C:\\Users\\Nasro'],
});

describe('Windows Sandbox fail-closed backend', () => {
  it('probes the enabled feature without an elevated-only cmdlet and accepts an active hypervisor', async () => {
    const runPowerShell = vi.fn(async (script) => {
      if (script.includes('Win32_OptionalFeature')) return '1';
      if (script.includes('HypervisorPresent')) return 'True';
      throw new Error('unexpected_probe');
    });
    const probes = createDefaultWindowsSandboxProbes({
      sandboxExecutable: 'C:\\Windows\\System32\\WindowsSandbox.exe',
      workspaceRoot: 'G:\\Mina', runtimeManifest: null, runPowerShell,
    });

    await expect(probes.feature()).resolves.toBe(true);
    await expect(probes.virtualization()).resolves.toBe(true);
    expect(runPowerShell.mock.calls[0][0]).not.toContain('Get-WindowsOptionalFeature');
  });

  it('probes NTFS via lightweight WMI on the computed drive letter — accented, not-yet-created workspace included', async () => {
    // Regression: the previous probe ran Get-Item on the workspace path (throws when the folder
    // does not exist yet) piped into Get-Volume (loads the Storage module and wakes the disk —
    // over the 10 s timeout on a sleeping HDD). Both made the whole sandbox intermittently report
    // « sandbox_probe_failed:ntfs ». The drive letter is computed in JS, so the accented path never
    // crosses PowerShell at all and the folder does not need to exist.
    const runPowerShell = vi.fn(async () => 'NTFS');
    const probes = createDefaultWindowsSandboxProbes({
      sandboxExecutable: 'C:\\Windows\\System32\\WindowsSandbox.exe',
      workspaceRoot: 'G:\\Programmes Installés\\caches\\MinaVision\\dossier-pas-encore-cree',
      runtimeManifest: null,
      runPowerShell,
    });

    await expect(probes.ntfs()).resolves.toBe(true);
    const script = runPowerShell.mock.calls[0][0];
    expect(script).toContain('Win32_LogicalDisk');
    expect(script).toContain("DeviceID='G:'");
    expect(script).not.toContain('Get-Item');
    expect(script).not.toContain('Get-Volume');
    expect(script).not.toContain('Installés');
  });

  it('answers false without touching PowerShell when the workspace has no drive letter', async () => {
    const runPowerShell = vi.fn(async () => 'NTFS');
    const probes = createDefaultWindowsSandboxProbes({
      sandboxExecutable: 'C:\\Windows\\System32\\WindowsSandbox.exe',
      workspaceRoot: '\\\\serveur\\partage\\sandbox',
      runtimeManifest: null,
      runPowerShell,
    });

    await expect(probes.ntfs()).resolves.toBe(false);
    expect(runPowerShell).not.toHaveBeenCalled();
  });

  it('reports a precise unavailable reason and never invokes a host runtime', async () => {
    for (const [probe, reason] of [
      ['feature', 'windows_sandbox_feature_disabled'],
      ['executable', 'windows_sandbox_executable_missing'],
      ['virtualization', 'virtualization_unavailable'],
      ['ntfs', 'sandbox_workspace_not_ntfs'],
      ['runtimes', 'sandbox_runtimes_unavailable'],
    ]) {
      const { backend, launcher } = harness({ probes: { [probe]: vi.fn(async () => false) } });
      await expect(backend.detect()).resolves.toEqual({ available: false, reason });
      await expect(backend.execute(execution)).rejects.toThrow(`sandbox_unavailable:${reason}`);
      expect(launcher).not.toHaveBeenCalled();
    }
  });

  it('rejects non-Windows hosts before all probes', async () => {
    const { backend, probes, launcher } = harness({ platform: 'linux' });
    await expect(backend.detect()).resolves.toEqual({ available: false, reason: 'windows_required' });
    expect(Object.values(probes).every((probe) => probe.mock.calls.length === 0)).toBe(true);
    expect(launcher).not.toHaveBeenCalled();
  });

  it('launches only WindowsSandbox.exe with a generated .wsb after every probe succeeds', async () => {
    const { backend, launcher } = harness();
    await expect(backend.detect()).resolves.toEqual({ available: true, reason: null });
    const result = await backend.execute(execution);
    expect(result).toMatchObject({ exitCode: 0, receipt: { status: 'completed' } });
    expect(launcher).toHaveBeenCalledWith({
      executable: 'C:\\Windows\\System32\\WindowsSandbox.exe',
      args: ['C:\\MinaJobs\\job-1\\job.wsb'],
      timeoutMs: 150_000,
      jobId: 'job-1',
      outPath: 'C:\\MinaJobs\\job-1\\out',
    });
  });
});
