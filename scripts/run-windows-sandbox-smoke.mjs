#!/usr/bin/env node
// Recette réelle non destructive : lance un job JavaScript minimal dans Windows Sandbox,
// réseau coupé, puis vérifie l'artifact exporté avant nettoyage.

import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJobWorkspaceManager } from '../src/sandbox/job-workspace.mjs';
import { createSandboxSourceDigest, parseSandboxJob, SANDBOX_PROFILES } from '../src/sandbox/job-schema.mjs';
import { createRuntimeManifest } from '../src/sandbox/runtime-manifest.mjs';
import { createWindowsSandboxLauncher } from '../src/sandbox/windows-sandbox-launcher.mjs';
import { createWindowsSandboxBackend } from '../src/sandbox/windows-sandbox.mjs';
import { resolveStorageRoots } from '../src/system/storage-roots.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENTRYPOINT = 'main.js';
const ARTIFACT = 'out/result.txt';
const DEFAULT_ATTEMPTS = 3;

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function createSmokeSource() {
  return [
    "import { writeFile } from 'node:fs/promises';",
    "const line = `MINA_SANDBOX_OK ${process.version}\\n`;",
    "await writeFile('C:/Mina/out/result.txt', line, 'utf8');",
    "console.log(line.trim());",
    '',
  ].join('\n');
}

export function buildSmokeJob({ sourceDigest }) {
  return Object.freeze({
    language: 'javascript',
    sourceFiles: Object.freeze([{ path: ENTRYPOINT, digest: sourceDigest, mode: 'read-only' }]),
    entrypoint: ENTRYPOINT,
    args: Object.freeze([]),
    profile: 'small',
    limits: SANDBOX_PROFILES.small,
    network: false,
    exports: Object.freeze([ARTIFACT]),
  });
}

export function shouldRetrySandboxSmokeError(error) {
  const message = String(error?.message ?? error);
  return message.includes('sandbox_start_failed:')
    || message.includes('wsb.exe start')
    || message.includes('0x80070002')
    || message.toLowerCase().includes('fichier spécifié est introuvable');
}

async function wait(milliseconds) {
  await new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function runSmokeOnce() {
  const userData = process.env.MINA_USERDATA_PATH
    ?? join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? ROOT, 'AppData', 'Roaming'), 'Mina Vision');
  const { sandboxRoot, sandboxRuntimeRoot } = resolveStorageRoots({ userDataPath: userData });
  const runtimeManifest = createRuntimeManifest({
    manifestPath: join(sandboxRuntimeRoot, 'runtime-manifest.json'),
    runtimeRoot: sandboxRuntimeRoot,
  });
  const runtimeStatus = await runtimeManifest.verify();
  if (!runtimeStatus.available) throw new Error(`sandbox_runtime_unavailable:${runtimeStatus.reason}`);

  const sourceRoot = await mkdtemp(join(tmpdir(), 'mina-sandbox-smoke-src-'));
  const jobId = `mina-smoke-${Date.now()}`;
  const source = createSmokeSource();
  await writeFile(join(sourceRoot, ENTRYPOINT), source, { flag: 'wx', encoding: 'utf8' });
  const rawJob = buildSmokeJob({ sourceDigest: sha256(source) });
  const sourceDigest = createSandboxSourceDigest(rawJob.sourceFiles);
  const job = parseSandboxJob(rawJob, {
    channel: 'local',
    explicitExecution: true,
    sourceConfirmation: { approved: true, digest: sourceDigest, token: 'windows-sandbox-smoke' },
  });

  await mkdir(sandboxRoot, { recursive: true });
  const workspaceManager = createJobWorkspaceManager({
    root: join(sandboxRoot, 'jobs'),
    bootstrapPath: sandboxRuntimeRoot,
  });
  const sandboxLauncher = createWindowsSandboxLauncher();
  const sandboxBackend = createWindowsSandboxBackend({
    workspaceRoot: sandboxRoot,
    runtimeManifest,
    launcher: sandboxLauncher.launch,
    writeWsb: async ({ xml }) => {
      const directory = join(sandboxRoot, 'configs');
      await mkdir(directory, { recursive: true });
      const filename = join(directory, `${jobId}.wsb`);
      await writeFile(filename, xml, { flag: 'wx', encoding: 'utf8' });
      return filename;
    },
  });

  let workspace = null;
  try {
    workspace = await workspaceManager.prepare({ jobId, sourceRoot, job });
    const result = await sandboxBackend.execute({ jobId, job, workspace, forbiddenRoots: [ROOT] });
    const artifactPath = join(workspace.outPath, 'result.txt');
    const artifact = await readFile(artifactPath, 'utf8');
    if (result?.exitCode !== 0 || result?.receipt?.exitCode !== 0 || !artifact.startsWith('MINA_SANDBOX_OK v')) {
      throw new Error('sandbox_smoke_artifact_invalid');
    }
    console.log(JSON.stringify({
      ok: true,
      jobId,
      sandbox: 'windows',
      network: false,
      artifact: artifact.trim(),
      receiptExitCode: result.receipt.exitCode,
      eventLogDigest: result.receipt.eventLogDigest,
    }, null, 2));
  } finally {
    if (workspace) await workspaceManager.cleanup(jobId).catch(() => {});
    await rm(sourceRoot, { recursive: true, force: true });
  }
}

async function main() {
  let lastError = null;
  for (let attempt = 1; attempt <= DEFAULT_ATTEMPTS; attempt += 1) {
    try {
      await runSmokeOnce();
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= DEFAULT_ATTEMPTS || !shouldRetrySandboxSmokeError(error)) throw error;
      console.error(`windows-sandbox-smoke: tentative ${attempt} échouée, retry — ${error?.message ?? error}`);
      await wait(3_000);
    }
  }
  throw lastError;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`windows-sandbox-smoke: échec — ${error?.message ?? error}`);
    process.exitCode = 1;
  });
}
