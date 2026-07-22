import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const JOB_ID = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const RUNTIME_ARGS = Object.freeze({
  python: (entrypoint, args) => ['-I', '-B', entrypoint, ...args],
  javascript: (entrypoint, args) => ['--disable-proto=throw', entrypoint, ...args],
  powershell: (entrypoint, args) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', entrypoint, ...args],
});

function within(root, relativePath, error) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\') || /^[a-z]:/iu.test(relativePath)
    || relativePath.startsWith('/') || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(error);
  const base = resolve(root);
  const target = resolve(join(base, ...relativePath.split('/')));
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error(error);
  return target;
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function cleanText(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
}

async function memoryProbeDefault(pid) {
  const { stdout } = await execFile('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
    windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024,
  });
  const fields = String(stdout).trim().match(/"([^"]*)"/gu)?.map((field) => field.slice(1, -1)) ?? [];
  const kib = Number(String(fields.at(-1) ?? '').replace(/[^0-9]/gu, ''));
  return Number.isFinite(kib) ? kib / 1024 : 0;
}

function terminateDefault(child) {
  child.kill();
  if (Number.isSafeInteger(child.pid)) {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.unref?.();
  }
}

export async function runGuestJob({
  sourceRoot = 'C:\\Mina\\src',
  outRoot = 'C:\\Mina\\out',
  runtimeRoot = 'C:\\Mina\\bootstrap',
  spawnChild = (file, args, options) => spawn(file, args, options),
  memoryProbe = memoryProbeDefault,
  terminate = terminateDefault,
  clock = Date.now,
} = {}) {
  await mkdir(outRoot, { recursive: true });
  const eventPath = join(outRoot, 'events.jsonl');
  const receiptPath = join(outRoot, 'guest-receipt.json');
  await writeFile(eventPath, '');
  let writeChain = Promise.resolve();
  const emit = (event) => {
    const line = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(line) > 64 * 1024) throw new Error('sandbox_stream_line_too_large');
    writeChain = writeChain.then(() => appendFile(eventPath, line, 'utf8'));
  };
  let job = null;
  let exitCode = 1;
  let artifacts = [];
  let memoryPeakMiB = 0;
  const startedAt = Number(clock());
  try {
    job = JSON.parse(await readFile(join(sourceRoot, 'job.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(join(runtimeRoot, 'runtime-manifest.json'), 'utf8'));
    if (!JOB_ID.test(job?.jobId ?? '') || job.network !== false || !RUNTIME_ARGS[job.language]
      || !Number.isSafeInteger(job?.limits?.wallMs) || job.limits.wallMs < 1 || job.limits.wallMs > 300_000
      || !Number.isSafeInteger(job?.limits?.memoryMiB) || job.limits.memoryMiB < 1 || job.limits.memoryMiB > 1_024
      || !Number.isSafeInteger(job?.limits?.outputBytes) || job.limits.outputBytes < 1 || job.limits.outputBytes > 10 * 1024 * 1024
      || !Array.isArray(job.sourceFiles) || !Array.isArray(job.args) || !Array.isArray(job.exports)) {
      throw new Error('sandbox_job_invalid');
    }
    for (const source of job.sourceFiles) {
      const path = within(sourceRoot, source.path, 'sandbox_source_escape');
      const bytes = await readFile(path);
      if (source.mode !== 'read-only' || source.digest !== `sha256:${hash(bytes)}`) throw new Error('sandbox_source_digest_mismatch');
    }
    const runtime = manifest.runtimes?.find((candidate) => candidate.language === job.language);
    if (!runtime || !DIGEST.test(`sha256:${runtime.sha256}`)) throw new Error('sandbox_runtime_missing');
    const runtimePath = within(runtimeRoot, runtime.path, 'sandbox_runtime_escape');
    if (hash(await readFile(runtimePath)) !== runtime.sha256) throw new Error('sandbox_runtime_digest_mismatch');
    const entrypoint = within(sourceRoot, job.entrypoint, 'sandbox_entrypoint_escape');
    if (job.args.some((arg) => typeof arg !== 'string' || arg.length > 2_000 || arg.includes('\0'))) throw new Error('sandbox_argument_invalid');

    emit({ type: 'started', jobId: job.jobId, at: new Date(clock()).toISOString() });
    const child = spawnChild(runtimePath, RUNTIME_ARGS[job.language](entrypoint, job.args), {
      cwd: sourceRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', TEMP: 'C:\\Windows\\Temp', TMP: 'C:\\Windows\\Temp' },
    });
    let outputBytes = 0;
    let failureReason = null;
    const consume = (type) => (chunk) => {
      if (failureReason) return;
      const text = cleanText(Buffer.from(chunk).toString('utf8'));
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > job.limits.outputBytes) {
        failureReason = 'sandbox_output_limit_exceeded';
        terminate(child);
        return;
      }
      if (text) emit({ type, text });
    };
    child.stdout.on('data', consume('stdout'));
    child.stderr.on('data', consume('stderr'));
    const closed = new Promise((resolveClose, rejectClose) => {
      child.once('error', rejectClose);
      child.once('close', (code) => resolveClose(Number.isSafeInteger(code) ? code : 1));
    });
    const monitor = setInterval(() => {
      void memoryProbe(child.pid).then((value) => {
        memoryPeakMiB = Math.max(memoryPeakMiB, Number(value) || 0);
        if (!failureReason && memoryPeakMiB > job.limits.memoryMiB) {
          failureReason = 'sandbox_memory_limit_exceeded';
          terminate(child);
        }
      }).catch(() => {});
    }, 100);
    monitor.unref?.();
    let timeout;
    const timedOut = new Promise((resolveTimeout) => {
      timeout = setTimeout(() => {
        failureReason = 'sandbox_wall_time_exceeded';
        terminate(child);
        resolveTimeout(1);
      }, job.limits.wallMs);
      timeout.unref?.();
    });
    exitCode = await Promise.race([closed, timedOut]);
    clearInterval(monitor);
    clearTimeout(timeout);
    if (failureReason) throw new Error(failureReason);
    emit({ type: 'usage', cpuMs: Math.max(0, Number(clock()) - startedAt), memoryPeakMiB });

    artifacts = [];
    for (const [index, exported] of job.exports.entries()) {
      if (typeof exported !== 'string' || !exported.startsWith('out/')) throw new Error('sandbox_artifact_escape');
      const path = within(outRoot, exported.slice(4), 'sandbox_artifact_escape');
      const descriptor = await stat(path).catch(() => null);
      if (!descriptor?.isFile()) continue;
      const bytes = await readFile(path);
      const artifact = { type: 'artifact', artifactId: `artifact-${index}`, path: exported, digest: `sha256:${hash(bytes)}`, bytes: bytes.byteLength };
      artifacts.push(artifact);
      emit(artifact);
    }
    emit({ type: 'completed', exitCode });
  } catch (error) {
    exitCode = 1;
    emit({ type: 'failed', category: 'sandbox_guest_failure', message: cleanText(error.message).slice(0, 2_000) });
  }
  await writeChain;
  const eventBytes = await readFile(eventPath);
  const receipt = {
    schemaVersion: 1,
    jobId: job?.jobId ?? 'invalid-job',
    sourceDigest: job?.sourceDigest ?? null,
    exitCode,
    completedAt: new Date(clock()).toISOString(),
    eventLogDigest: `sha256:${hash(eventBytes)}`,
    artifacts,
    signatureState: 'awaiting_host_signature',
  };
  await writeFile(receiptPath, JSON.stringify(receipt), 'utf8');
  return Object.freeze(receipt);
}

const invokedDirectly = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (invokedDirectly) {
  const receipt = await runGuestJob();
  process.exitCode = receipt.exitCode;
}
