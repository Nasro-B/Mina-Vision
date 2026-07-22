import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { computeSkillManifest, readSkillMetadata } from './skill-loader.mjs';

const SCRIPT_EXTENSIONS = new Set(['.py', '.js', '.ts', '.ps1']);
const FORBIDDEN_EXTENSIONS = new Set(['.exe', '.dll', '.msi', '.com', '.bat', '.cmd', '.scr']);
const DEPENDENCY_FILES = new Set(['package.json', 'requirements.txt', 'pyproject.toml', 'pdm.lock', 'poetry.lock']);

function extension(path) {
  const index = path.lastIndexOf('.');
  return index < 0 ? '' : path.slice(index).toLowerCase();
}

export async function auditSkillPackage({ directory } = {}) {
  if (!directory) throw new TypeError('skill_audit_directory_required');
  const parsed = await readSkillMetadata(directory);
  const manifest = await computeSkillManifest({ directory });
  const digestMatches = parsed.metadata.digest === manifest.digest;
  const declaredScripts = new Set(parsed.metadata.entrypoints.scripts);
  const detectedScripts = manifest.files.filter(({ path }) => SCRIPT_EXTENSIONS.has(extension(path))).map(({ path }) => path);
  const undeclaredScripts = detectedScripts.filter((path) => !declaredScripts.has(path));
  const executables = manifest.files.filter(({ path }) => FORBIDDEN_EXTENSIONS.has(extension(path))).map(({ path }) => path);
  const dependencies = manifest.files
    .filter(({ path }) => DEPENDENCY_FILES.has(path.split('/').at(-1).toLowerCase()))
    .map(({ path }) => path);
  let licenseStatus = 'unknown';
  const licenseFiles = manifest.files.filter(({ path }) => /(?:^|\/)licen[cs]e(?:\.|$)/iu.test(path));
  for (const { path, size } of licenseFiles) {
    if (size > 512 * 1024) continue;
    const text = await readFile(join(directory, ...path.split('/')), 'utf8');
    if (/affero|\bagpl\b/iu.test(text)) {
      licenseStatus = 'incompatible_agpl';
      break;
    }
    licenseStatus = 'declared';
  }
  const issues = [];
  if (!digestMatches) issues.push('manifest_digest_mismatch');
  if (undeclaredScripts.length) issues.push('undeclared_scripts');
  if (executables.length) issues.push('forbidden_executables');
  if (licenseStatus === 'incompatible_agpl') issues.push('incompatible_agpl');
  return Object.freeze({
    name: parsed.metadata.name,
    version: parsed.metadata.version,
    digest: manifest.digest,
    declaredDigest: parsed.metadata.digest,
    capabilities: parsed.metadata.capabilities,
    channels: parsed.metadata.channels,
    scripts: Object.freeze([...declaredScripts].sort()),
    detectedScripts: Object.freeze(detectedScripts.sort()),
    undeclaredScripts: Object.freeze(undeclaredScripts.sort()),
    executables: Object.freeze(executables.sort()),
    dependencies: Object.freeze(dependencies.sort()),
    references: parsed.metadata.entrypoints.references,
    licenseStatus,
    issues: Object.freeze(issues),
    installable: issues.length === 0,
    fileCount: manifest.files.length,
    totalBytes: manifest.files.reduce((total, file) => total + file.size, 0),
  });
}
