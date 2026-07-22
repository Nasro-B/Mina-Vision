const OPAQUE_ID = /^[a-z0-9][a-z0-9-]{0,100}$/u;

function exactIdentifierRequest(value, field, error) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 1 || !OPAQUE_ID.test(value[field] ?? '')) {
    throw new TypeError(error);
  }
  return value[field];
}

function artifactRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'artifactId,jobId'
    || !OPAQUE_ID.test(value.jobId ?? '') || !OPAQUE_ID.test(value.artifactId ?? '')) {
    throw new TypeError('sandbox_ui_request_invalid');
  }
  return { jobId: value.jobId, artifactId: value.artifactId };
}

function publicSkill(skill) {
  return Object.freeze({
    name: skill.name,
    version: skill.version,
    digest: skill.digest,
    capabilities: Object.freeze([...(skill.capabilities ?? [])]),
    channels: Object.freeze([...(skill.channels ?? [])]),
  });
}

export function createSkillsSandboxController({
  loadInstructions,
  skillRegistry,
  bundledSkillRegistry,
  skillInstaller,
  selectSkillPackage,
  sandboxManager,
} = {}) {
  if (typeof loadInstructions !== 'function' || !skillRegistry?.scan || !skillInstaller?.stage
    || !skillInstaller?.install || typeof selectSkillPackage !== 'function' || !sandboxManager?.status
    || !sandboxManager?.list || !sandboxManager?.executeProposal || !sandboxManager?.cancel
    || !sandboxManager?.importArtifact) {
    throw new TypeError('skills_sandbox_controller_dependencies_required');
  }

  async function status() {
    const [instructions, installedSkills, bundledSkills, sandbox, listing] = await Promise.all([
      loadInstructions(), skillRegistry.scan(), bundledSkillRegistry?.scan?.() ?? [], sandboxManager.status(), Promise.resolve(sandboxManager.list()),
    ]);
    return Object.freeze({
      instructions: Object.freeze({ version: instructions.version, digest: instructions.digest }),
      installedSkills: Object.freeze(installedSkills.map(publicSkill)),
      bundledSkills: Object.freeze(bundledSkills.map(publicSkill)),
      sandbox: Object.freeze({
        available: sandbox.available === true,
        reason: sandbox.reason ?? null,
        remediation: sandbox.remediation ?? null,
      }),
      proposals: Object.freeze([...(listing.proposals ?? [])]),
      jobs: Object.freeze([...(listing.jobs ?? [])]),
      artifacts: Object.freeze([...(listing.artifacts ?? [])]),
    });
  }

  async function chooseAndStageSkill() {
    const sourcePath = await selectSkillPackage();
    if (sourcePath === null) return Object.freeze({ canceled: true });
    if (typeof sourcePath !== 'string' || !sourcePath) throw new Error('skill_package_selection_invalid');
    return skillInstaller.stage({ sourcePath });
  }

  async function installSkill(request) {
    const quarantineId = exactIdentifierRequest(request, 'quarantineId', 'skills_ui_request_invalid');
    const result = await skillInstaller.install({ quarantineId });
    await skillRegistry.scan();
    return result;
  }

  const executeSandbox = async (request) => sandboxManager.executeProposal(
    exactIdentifierRequest(request, 'proposalId', 'sandbox_ui_request_invalid'),
  );
  const cancelSandbox = async (request) => sandboxManager.cancel(
    exactIdentifierRequest(request, 'jobId', 'sandbox_ui_request_invalid'),
  );
  const importArtifact = async (request) => sandboxManager.importArtifact(artifactRequest(request));

  return Object.freeze({
    status, chooseAndStageSkill, installSkill, executeSandbox, cancelSandbox, importArtifact,
  });
}
