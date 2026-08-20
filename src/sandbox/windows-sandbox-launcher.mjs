import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile as readFileDefault } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const SAFE_JOB_ID = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

const startDefault = async ({ sessionId, configXml }) => {
  try {
    await execFile('wsb.exe', ['start', '--id', sessionId, '--config', configXml, '--raw'], {
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 64 * 1024,
    });
  } catch (error) {
    const detail = [error?.stderr, error?.stdout, error?.message].filter(Boolean).join(' ').slice(0, 1_000);
    throw new Error(`sandbox_start_failed:${detail}`);
  }
  return { started: true };
};

const stopDefault = async (sessionId) => {
  await execFile('wsb.exe', ['stop', '--id', sessionId, '--raw'], {
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 64 * 1024,
  });
  return { stopped: true };
};

const execDefault = async ({ sessionId, command }) => {
  const { stdout } = await execFile('wsb.exe', [
    'exec', '--id', sessionId, '--command', command, '--run-as', 'System', '--raw',
  ], {
    windowsHide: true,
    timeout: 7 * 60_000,
    maxBuffer: 64 * 1024,
  });
  const payload = JSON.parse(stdout);
  return { exitCode: Number(payload.ExitCode) };
};

export function createWindowsSandboxLauncher({
  startSession = startDefault,
  execSession = execDefault,
  stopSession = stopDefault,
  readFile = readFileDefault,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  clock = Date.now,
  ids = randomUUID,
} = {}) {
  const active = new Map();

  async function launch({ executable, args, timeoutMs, jobId, outPath } = {}) {
    if (!executable || !Array.isArray(args) || args.length !== 1
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1
      || !SAFE_JOB_ID.test(jobId ?? '') || !outPath) throw new TypeError('sandbox_launcher_request_invalid');
    if (active.has(jobId)) throw new Error('sandbox_job_already_active');
    const sessionId = String(ids());
    if (!UUID.test(sessionId)) throw new Error('sandbox_session_id_invalid');
    active.set(jobId, sessionId);
    const deadline = Number(clock()) + timeoutMs;
    const receiptPath = join(outPath, 'guest-receipt.json');
    try {
      const configBytes = await readFile(args[0]);
      if (configBytes.byteLength > 64 * 1024) throw new Error('sandbox_config_too_large');
      const configXml = new TextDecoder('utf-8', { fatal: true }).decode(configBytes).replace(/^\uFEFF/u, '');
      await startSession({ sessionId, configXml });
      await execSession({
        sessionId,
        command: 'C:\\Mina\\bootstrap\\javascript\\node.exe C:\\Mina\\bootstrap\\mina-runner.mjs',
      });
      for (;;) {
        let receipt = null;
        try {
          const bytes = await readFile(receiptPath);
          if (bytes.byteLength > 1024 * 1024) throw new Error('sandbox_receipt_too_large');
          receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ''));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        if (receipt) {
          if (receipt.schemaVersion !== 1 || receipt.jobId !== jobId || !Number.isSafeInteger(receipt.exitCode)) {
            throw new Error('sandbox_receipt_invalid');
          }
          await stopSession(sessionId);
          return Object.freeze({ exitCode: receipt.exitCode, receipt: Object.freeze(receipt) });
        }
        if (Number(clock()) >= deadline) {
          await stopSession(sessionId).catch(() => {});
          throw new Error('sandbox_wall_time_exceeded');
        }
        await wait(250);
      }
    } finally {
      active.delete(jobId);
    }
  }

  async function cancel(jobId) {
    const sessionId = active.get(jobId);
    if (!sessionId) return Object.freeze({ canceled: false, jobId });
    await stopSession(sessionId);
    active.delete(jobId);
    return Object.freeze({ canceled: true, jobId });
  }

  return Object.freeze({ launch, cancel });
}
