const ID = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REMEDIATION = Object.freeze({
  windows_required: 'Le bac à sable multilangage exige Windows.',
  windows_sandbox_feature_disabled: 'Activez la fonctionnalité Windows Sandbox, puis redémarrez Windows.',
  windows_sandbox_executable_missing: 'Windows Sandbox n’est pas installé sur cette édition de Windows.',
  virtualization_unavailable: 'Activez la virtualisation matérielle dans l’UEFI/BIOS.',
  sandbox_workspace_not_ntfs: 'Placez l’espace de travail du sandbox sur un volume NTFS.',
  sandbox_runtimes_unavailable: 'Installez et vérifiez les runtimes portables signés de Mina Vision.',
  'sandbox_probe_failed:feature': "La détection de Windows Sandbox a échoué ; l’état n’est pas présenté comme désactivé.",
  'sandbox_probe_failed:executable': "La détection de l’exécutable Windows Sandbox a échoué.",
  'sandbox_probe_failed:virtualization': "La détection de la virtualisation a échoué.",
  'sandbox_probe_failed:ntfs': "La détection du volume NTFS a échoué.",
  'sandbox_probe_failed:runtimes': "La vérification des runtimes portables a échoué.",
});

function publicProposal(value) {
  return Object.freeze({
    proposalId: value.proposalId,
    digest: value.digest,
    summary: value.summary,
    requestedPermissions: Object.freeze([...value.requestedPermissions]),
  });
}

export function createSandboxUiManager({ backend, revalidateProposal, confirmLocal, runner } = {}) {
  if (!backend?.detect || typeof revalidateProposal !== 'function' || typeof confirmLocal !== 'function'
    || !runner?.execute || !runner?.cancel || !runner?.importArtifact) {
    throw new TypeError('sandbox_ui_manager_dependencies_required');
  }
  const proposals = new Map();
  const jobs = new Map();
  const artifacts = new Map();

  async function status() {
    const result = await backend.detect();
    return Object.freeze({
      available: result.available === true,
      reason: result.reason ?? null,
      remediation: result.available ? null : (REMEDIATION[result.reason] ?? 'Le sandbox est indisponible.'),
    });
  }

  function registerProposal(proposal) {
    if (!proposal || !ID.test(proposal.proposalId ?? '') || !DIGEST.test(proposal.digest ?? '')
      || typeof proposal.summary !== 'string' || proposal.summary.length < 1 || proposal.summary.length > 2_000
      || !Array.isArray(proposal.requestedPermissions)
      || proposal.requestedPermissions.some((item) => typeof item !== 'string' || item.length > 100)) {
      throw new TypeError('sandbox_proposal_invalid');
    }
    if (proposals.has(proposal.proposalId)) throw new Error('sandbox_proposal_duplicate');
    proposals.set(proposal.proposalId, structuredClone(proposal));
    return publicProposal(proposal);
  }

  function list() {
    return Object.freeze({
      proposals: Object.freeze([...proposals.values()].map(publicProposal)),
      jobs: Object.freeze([...jobs.values()].map((job) => structuredClone(job))),
      artifacts: Object.freeze([...artifacts.values()].map((artifact) => structuredClone(artifact))),
    });
  }

  async function executeProposal(proposalId) {
    if (!ID.test(proposalId ?? '')) throw new TypeError('sandbox_proposal_id_invalid');
    const proposal = proposals.get(proposalId);
    if (!proposal) throw new Error('sandbox_proposal_unknown');
    const availability = await status();
    if (!availability.available) throw new Error(`sandbox_unavailable:${availability.reason}`);
    const fresh = await revalidateProposal(structuredClone(proposal));
    if (!fresh || fresh.digest !== proposal.digest) throw new Error('sandbox_proposal_stale');
    const confirmation = await confirmLocal({
      reason: 'Exécuter ce code dans Windows Sandbox avec des limites strictes.',
      action: { name: 'sandbox.execute', proposalId, digest: fresh.digest, requestedPermissions: proposal.requestedPermissions },
    });
    if (!confirmation?.approved || confirmation.digest !== fresh.digest || typeof confirmation.token !== 'string') {
      throw new Error('sandbox_execution_refused');
    }
    const job = await runner.execute({ ...fresh, confirmationToken: confirmation.token });
    if (!job || !ID.test(job.jobId ?? '')) throw new Error('sandbox_job_receipt_invalid');
    jobs.set(job.jobId, structuredClone(job));
    proposals.delete(proposalId);
    return structuredClone(job);
  }

  async function cancel(jobId) {
    if (!ID.test(jobId ?? '')) throw new TypeError('sandbox_job_id_invalid');
    const result = await runner.cancel(jobId);
    const current = jobs.get(jobId);
    if (current) jobs.set(jobId, { ...current, status: 'canceled' });
    return result;
  }

  async function cancelAll() {
    return Promise.allSettled([...jobs.keys()].map((jobId) => cancel(jobId)));
  }

  async function importArtifact(request) {
    if (!request || !ID.test(request.jobId ?? '') || !ID.test(request.artifactId ?? '')) {
      throw new TypeError('sandbox_artifact_request_invalid');
    }
    return runner.importArtifact(request);
  }

  return Object.freeze({ status, registerProposal, list, executeProposal, cancel, cancelAll, importArtifact });
}
