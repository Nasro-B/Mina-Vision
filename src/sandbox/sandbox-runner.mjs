import { createHash } from 'node:crypto';
import { basename, join, resolve, sep } from 'node:path';
import { copyFile, mkdir, readFile } from 'node:fs/promises';

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function within(root, candidate) {
  const base = resolve(root);
  const target = resolve(candidate);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error('sandbox_artifact_escape');
  return target;
}

export function createSandboxRunner({
  backend,
  workspaceManager,
  launcher,
  importRoot = null,
  confirmLocal = async () => ({ approved: false }),
} = {}) {
  if (!backend?.execute || !workspaceManager?.prepare || !launcher?.cancel) {
    throw new TypeError('sandbox_runner_dependencies_required');
  }
  const artifacts = new Map();

  async function execute({ jobId, sourceRoot, job } = {}) {
    if (!SAFE_ID.test(jobId ?? '') || !sourceRoot || !job?.sourceDigest || !job?.limits) {
      throw new TypeError('sandbox_runner_request_invalid');
    }
    const workspace = await workspaceManager.prepare({ jobId, sourceRoot, job });
    const result = await backend.execute({ jobId, job, workspace });
    const receipt = result?.receipt;
    if (receipt?.schemaVersion !== 1 || receipt.jobId !== jobId || receipt.sourceDigest !== job.sourceDigest
      || !Number.isSafeInteger(receipt.exitCode) || !Array.isArray(receipt.artifacts)) {
      throw new Error('sandbox_receipt_invalid');
    }
    const publicArtifacts = receipt.artifacts.map((artifact) => {
      if (!SAFE_ID.test(artifact?.artifactId ?? '') || typeof artifact.path !== 'string'
        || !artifact.path.startsWith('out/') || !DIGEST.test(artifact.digest ?? '')
        || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) throw new Error('sandbox_artifact_invalid');
      const relative = artifact.path.slice(4).replaceAll('/', sep);
      const hostPath = within(workspace.outPath, join(workspace.outPath, relative));
      artifacts.set(`${jobId}:${artifact.artifactId}`, { ...artifact, jobId, hostPath });
      return Object.freeze({ ...artifact });
    });
    return Object.freeze({
      jobId,
      status: receipt.exitCode === 0 ? 'completed' : 'failed',
      exitCode: receipt.exitCode,
      artifacts: Object.freeze(publicArtifacts),
    });
  }

  async function importArtifact({ jobId, artifactId } = {}) {
    if (!SAFE_ID.test(jobId ?? '') || !SAFE_ID.test(artifactId ?? '') || !importRoot) {
      throw new TypeError('sandbox_artifact_request_invalid');
    }
    const artifact = artifacts.get(`${jobId}:${artifactId}`);
    if (!artifact) throw new Error('sandbox_artifact_unknown');
    const bytes = await readFile(artifact.hostPath);
    const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (actual !== artifact.digest || bytes.byteLength !== artifact.bytes) throw new Error('sandbox_artifact_digest_mismatch');
    const confirmation = await confirmLocal({
      reason: `Importer l’artifact vérifié ${basename(artifact.hostPath)} ?`,
      action: { name: 'sandbox.import_artifact', digest: artifact.digest },
    });
    if (!confirmation?.approved || confirmation.digest !== artifact.digest) throw new Error('sandbox_artifact_import_refused');
    const destinationRoot = within(importRoot, join(importRoot, jobId));
    await mkdir(destinationRoot, { recursive: true });
    const destination = within(destinationRoot, join(destinationRoot, basename(artifact.hostPath)));
    await copyFile(artifact.hostPath, destination);
    return Object.freeze({ imported: true, jobId, artifactId, path: destination, digest: artifact.digest });
  }

  return Object.freeze({ execute, cancel: launcher.cancel, importArtifact });
}
