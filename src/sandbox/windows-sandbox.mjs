import { access } from 'node:fs/promises';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { parse, resolve } from 'node:path';
import { promisify } from 'node:util';
import { buildWsbConfig } from './wsb-builder.mjs';

const execFile = promisify(execFileCallback);

async function powershell(script) {
  const { stdout } = await execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  return stdout.trim();
}

export function createDefaultWindowsSandboxProbes({ sandboxExecutable, workspaceRoot, runtimeManifest, runPowerShell = powershell }) {
  return {
    feature: async () => (await runPowerShell("(Get-CimInstance Win32_OptionalFeature -Filter \"Name='Containers-DisposableClientVM'\").InstallState")) === '1',
    executable: async () => access(sandboxExecutable).then(() => true, () => false),
    virtualization: async () => (await runPowerShell("$cs = Get-CimInstance Win32_ComputerSystem; $cpu = Get-CimInstance Win32_Processor; if ($cs.HypervisorPresent -or @($cpu | Where-Object VirtualizationFirmwareEnabled).Count -gt 0) { 'True' } else { 'False' }")) === 'True',
    ntfs: async () => {
      // Win32_LogicalDisk answers from the WMI cache in a few hundred ms. The previous probe ran
      // Get-Item on the workspace path (throws when the folder does not exist yet) piped into
      // Get-Volume (loads the Storage module and spins up the disk — over the 10 s timeout on a
      // sleeping HDD): the whole sandbox then intermittently reported « sandbox_probe_failed:ntfs ».
      // Computing the drive letter here also keeps the accented path out of PowerShell entirely.
      const drive = parse(resolve(String(workspaceRoot ?? ''))).root.slice(0, 2);
      if (!/^[A-Za-z]:$/u.test(drive)) return false;
      return (await runPowerShell(`(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'").FileSystem`)) === 'NTFS';
    },
    runtimes: async () => runtimeManifest?.verify?.().then((result) => result?.available === true, () => false) ?? false,
  };
}

async function defaultLauncher({ executable, args, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: 'ignore' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    timer.unref?.();
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('sandbox_wall_time_exceeded'));
      else resolve({ exitCode: code, receipt: null });
    });
  });
}

export function createWindowsSandboxBackend({
  platform = process.platform,
  probes,
  launcher = defaultLauncher,
  writeWsb,
  sandboxExecutable = 'C:\\Windows\\System32\\WindowsSandbox.exe',
  workspaceRoot,
  runtimeManifest,
} = {}) {
  const activeProbes = probes ?? createDefaultWindowsSandboxProbes({ sandboxExecutable, workspaceRoot, runtimeManifest });
  if (!activeProbes?.feature || !activeProbes?.executable || !activeProbes?.virtualization
    || !activeProbes?.ntfs || !activeProbes?.runtimes || typeof launcher !== 'function' || typeof writeWsb !== 'function') {
    throw new TypeError('windows_sandbox_dependencies_required');
  }

  async function detect() {
    if (platform !== 'win32') return Object.freeze({ available: false, reason: 'windows_required' });
    for (const [probe, reason] of [
      ['feature', 'windows_sandbox_feature_disabled'],
      ['executable', 'windows_sandbox_executable_missing'],
      ['virtualization', 'virtualization_unavailable'],
      ['ntfs', 'sandbox_workspace_not_ntfs'],
      ['runtimes', 'sandbox_runtimes_unavailable'],
    ]) {
      try {
        if (await activeProbes[probe]() !== true) return Object.freeze({ available: false, reason });
      } catch {
        return Object.freeze({ available: false, reason: `sandbox_probe_failed:${probe}` });
      }
    }
    return Object.freeze({ available: true, reason: null });
  }

  async function execute({ jobId, job, workspace, forbiddenRoots = [] } = {}) {
    const availability = await detect();
    if (!availability.available) throw new Error(`sandbox_unavailable:${availability.reason}`);
    if (typeof jobId !== 'string' || !jobId || !Number.isSafeInteger(job?.limits?.wallMs)
      || !workspace?.sourcePath || !workspace?.outPath || !workspace?.bootstrapPath) {
      throw new TypeError('sandbox_execution_invalid');
    }
    const xml = buildWsbConfig(workspace, { forbiddenRoots });
    const configPath = await writeWsb({ jobId, xml, workspace });
    if (typeof configPath !== 'string' || !configPath.toLowerCase().endsWith('.wsb')) throw new Error('sandbox_config_write_invalid');
    return launcher({
      executable: sandboxExecutable,
      args: [configPath],
      // Windows Sandbox cold boot can take well over 30 seconds after a restart. The guest process
      // still enforces job.limits.wallMs itself; this host allowance covers VM startup/shutdown only.
      timeoutMs: job.limits.wallMs + 120_000,
      jobId,
      outPath: workspace.outPath,
    });
  }

  return Object.freeze({ detect, execute });
}
