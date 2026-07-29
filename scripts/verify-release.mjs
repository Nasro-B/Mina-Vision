import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const MAX_OUTPUT_LENGTH = 2_000;
const MAX_CAPTURE_LENGTH = 16_000;
const SENSITIVE_VALUE = /((?:api[_-]?key|token|password|private[_ -]?key|refresh[_-]?token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/giu;
const BEARER_VALUE = /\bBearer\s+\S+/giu;

const MANUAL_CHECKS = Object.freeze([
  Object.freeze({ name: 'android_physical_acceptance', status: 'unrun', reason: 'physical_device_authorization_required' }),
  Object.freeze({ name: 'home_safe_light_acceptance', status: 'unrun', reason: 'signed_sdk_and_safe_device_required' }),
  Object.freeze({ name: 'provider_dedicated_account_acceptance', status: 'unrun', reason: 'dedicated_test_accounts_required' }),
  Object.freeze({ name: 'sandbox_isolation_acceptance', status: 'unrun', reason: 'windows_sandbox_proof_required' }),
  Object.freeze({ name: 'local_voice_offline_acceptance', status: 'unrun', reason: 'microphone_and_offline_turn_required' }),
]);

function appendBounded(current, chunk) {
  if (current.length >= MAX_CAPTURE_LENGTH) return current;
  return `${current}${String(chunk)}`.slice(0, MAX_CAPTURE_LENGTH);
}

function redactAndBound(value) {
  const redacted = String(value ?? '')
    .replace(SENSITIVE_VALUE, '$1[REDACTED]')
    .replace(BEARER_VALUE, 'Bearer [REDACTED]');
  if (redacted.length <= MAX_OUTPUT_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_OUTPUT_LENGTH - 14)}…[truncated]`;
}

function isCapabilityMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function extractJsonReport(output) {
  const text = String(output ?? '');
  for (let index = text.indexOf('{'); index >= 0; index = text.indexOf('{', index + 1)) {
    try {
      const parsed = JSON.parse(text.slice(index));
      return isCapabilityMap(parsed) ? parsed : null;
    } catch {
      // The command preamble can contain arbitrary text before the final JSON report.
    }
  }
  return null;
}

function runCommand({ command, args = [], cwd = process.cwd(), env = process.env } = {}) {
  if (typeof command !== 'string' || command.length === 0) throw new TypeError('release_command_required');
  if (!Array.isArray(args) || !args.every((argument) => typeof argument === 'string')) {
    throw new TypeError('release_command_args_invalid');
  }

  return new Promise((resolveCommand) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolveCommand(result);
    };
    let child;
    try {
      child = spawn(command, args, { cwd, env, shell: false, windowsHide: true });
    } catch (error) {
      settle({ exitCode: 1, stderr: `release_command_spawn_failed:${String(error?.message ?? error)}` });
      return;
    }
    child.stdout?.on('data', (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.once('error', (error) => settle({
      exitCode: 1,
      stdout,
      stderr: appendBounded(stderr, `release_command_spawn_failed:${String(error?.message ?? error)}`),
    }));
    child.once('close', (code) => settle({ exitCode: Number.isInteger(code) ? code : 1, stdout, stderr }));
  });
}

export function buildNpmRunCommand(script, {
  npmExecPath = process.env.npm_execpath,
  nodeExecutable = process.execPath,
  platform = process.platform,
  comSpec = process.env.ComSpec || 'cmd.exe',
} = {}) {
  if (typeof script !== 'string' || !/^[a-z0-9:_-]+$/iu.test(script)) {
    throw new TypeError('release_npm_script_invalid');
  }
  if (typeof npmExecPath === 'string' && npmExecPath.length > 0) {
    return Object.freeze({ command: nodeExecutable, args: Object.freeze([npmExecPath, 'run', script]) });
  }
  if (platform === 'win32') {
    return Object.freeze({ command: comSpec, args: Object.freeze(['/d', '/s', '/c', `npm run ${script}`]) });
  }
  return Object.freeze({ command: 'npm', args: Object.freeze(['run', script]) });
}

function defaultCommands() {
  return [
    { name: 'unit', ...buildNpmRunCommand('test:unit') },
    { name: 'integration', ...buildNpmRunCommand('test:integration') },
    { name: 'smoke', ...buildNpmRunCommand('test:smoke') },
    { name: 'sqlite_electron_smoke', ...buildNpmRunCommand('smoke:sqlite:electron') },
    { name: 'verify', ...buildNpmRunCommand('verify') },
  ];
}

function normalizeCommandResult(result) {
  const exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : 1;
  const stdout = String(result?.stdout ?? '');
  const stderr = String(result?.stderr ?? '');
  const jsonReport = extractJsonReport(stdout);
  return {
    exitCode,
    stdout: redactAndBound(stdout),
    stderr: redactAndBound(stderr),
    capabilities: isCapabilityMap(result?.capabilities)
      ? result.capabilities
      : jsonReport?.capabilities,
  };
}

/**
 * Runs reproducible automated release checks. Manual acceptance is deliberately
 * reported as unrun: this runner cannot turn a physical or account-based gate green.
 */
export async function verifyRelease({ commands = defaultCommands(), requiredCapabilities = [], clock = Date.now } = {}) {
  if (!Array.isArray(commands)) throw new TypeError('release_commands_invalid');
  if (!Array.isArray(requiredCapabilities) || !requiredCapabilities.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new TypeError('release_required_capabilities_invalid');
  }
  if (typeof clock !== 'function') throw new TypeError('release_clock_invalid');

  const checks = [];
  const capabilities = {};
  for (const entry of commands) {
    if (!entry || typeof entry.name !== 'string' || entry.name.length === 0) {
      throw new TypeError('release_command_name_required');
    }
    let rawResult;
    try {
      rawResult = typeof entry.run === 'function' ? await entry.run() : await runCommand(entry);
    } catch (error) {
      rawResult = { exitCode: 1, stderr: `release_command_failed:${String(error?.message ?? error)}` };
    }
    const result = normalizeCommandResult(rawResult);
    if (isCapabilityMap(result.capabilities)) Object.assign(capabilities, result.capabilities);
    checks.push(Object.freeze({
      name: entry.name,
      exitCode: result.exitCode,
      status: result.exitCode === 0 ? 'pass' : 'fail',
      ...(result.stdout ? { stdout: result.stdout } : {}),
      ...(result.stderr ? { stderr: result.stderr } : {}),
    }));
  }

  for (const id of requiredCapabilities) {
    if (capabilities[id]?.status === 'available') continue;
    checks.push(Object.freeze({
      name: `capability:${id}`,
      exitCode: 1,
      status: 'fail',
      reason: `capability_not_available:${id}`,
    }));
  }

  return Object.freeze({
    status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
    checks: Object.freeze(checks),
    manual: MANUAL_CHECKS,
    generatedAt: clock(),
  });
}

async function main() {
  const report = await verifyRelease();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === 'pass' ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`verify_release_failed:${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}
