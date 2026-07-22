import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { auditSkillPackage } from './skill-auditor.mjs';
import { createSkillLoader } from './skill-loader.mjs';

const MAX_FILES = 500;
const MAX_BYTES = 20 * 1024 * 1024;
// Anti-bombe (R-02) : au-delà de ce ratio déclaré taille/compressé, l'entrée est refusée AVANT
// getData() — la décompression d'une bombe en mémoire n'a jamais lieu. Le seuil ne s'applique
// qu'aux entrées significatives : en dessous, MAX_BYTES borne déjà le coût.
const MAX_EXPANSION_RATIO = 100;
const EXPANSION_CHECK_MIN_BYTES = 64 * 1024;
const ARCHIVES = new Set(['.zip', '.7z', '.rar', '.tar', '.tgz', '.gz', '.bz2', '.xz']);
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,100}$/u;

function safeRelative(path, error = 'skill_archive_path_invalid') {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.startsWith('/') || /^[a-z]:/iu.test(path)
    || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(error);
  }
  return path;
}

function ensureWithin(root, target, error) {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath}${sep}`)) throw new Error(error);
  return targetPath;
}

async function listFolder(root, current = root, files = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    const stat = await lstat(absolute);
    if (entry.isSymbolicLink() || stat.isSymbolicLink()) throw new Error('skill_reparse_point_forbidden');
    if (entry.isDirectory()) {
      await listFolder(root, absolute, files);
      continue;
    }
    if (!entry.isFile()) throw new Error('skill_special_file_forbidden');
    const relative = absolute.slice(root.length + 1).split(sep).join('/');
    safeRelative(relative, 'skill_source_path_invalid');
    if (ARCHIVES.has(extname(relative).toLowerCase())) throw new Error('skill_nested_archive_forbidden');
    files.push({ absolute, relative, size: stat.size });
    if (files.length > MAX_FILES) throw new Error('skill_file_count_exceeded');
    if (files.reduce((total, file) => total + file.size, 0) > MAX_BYTES) throw new Error('skill_total_size_exceeded');
  }
  return files;
}

async function copyFolder(source, target) {
  const sourceStat = await lstat(source);
  if (sourceStat.isSymbolicLink()) throw new Error('skill_reparse_point_forbidden');
  if (!sourceStat.isDirectory()) throw new Error('skill_source_invalid');
  const sourceReal = await realpath(source);
  const files = await listFolder(sourceReal);
  for (const file of files) {
    const destination = ensureWithin(target, join(target, ...file.relative.split('/')), 'skill_quarantine_escape');
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(file.absolute, destination);
  }
}

function zipEntryPath(name) {
  const path = String(name ?? '').replace(/\/$/u, '');
  if (!path) return null;
  return safeRelative(path);
}

function isZipSymlink(entry) {
  const unixMode = (Number(entry.attr ?? 0) >>> 16) & 0o170000;
  return unixMode === 0o120000;
}

async function extractZip(source, target) {
  const { default: AdmZip } = await import('adm-zip');
  const archive = new AdmZip(await readFile(source));
  const rawEntries = archive.getEntries();
  const descriptors = [];
  for (const entry of rawEntries) {
    const path = zipEntryPath(entry.entryName);
    if (!path) continue;
    if (isZipSymlink(entry)) throw new Error('skill_reparse_point_forbidden');
    if (entry.header?.flags & 1) throw new Error('skill_archive_encrypted_forbidden');
    if (entry.isDirectory) continue;
    if (ARCHIVES.has(extname(path).toLowerCase())) throw new Error('skill_nested_archive_forbidden');
    const size = Number(entry.header?.size ?? 0);
    const compressedSize = Number(entry.header?.compressedSize ?? 0);
    if (!Number.isFinite(size) || size < 0 || !Number.isFinite(compressedSize) || compressedSize < 0) {
      throw new Error('skill_archive_size_invalid');
    }
    if (size > EXPANSION_CHECK_MIN_BYTES
      && (compressedSize === 0 || size / compressedSize > MAX_EXPANSION_RATIO)) {
      throw new Error('skill_archive_expansion_limit');
    }
    descriptors.push({ entry, path, size });
    if (descriptors.length > MAX_FILES) throw new Error('skill_file_count_exceeded');
    if (descriptors.reduce((total, value) => total + value.size, 0) > MAX_BYTES) throw new Error('skill_total_size_exceeded');
  }
  let prefix = '';
  if (!descriptors.some(({ path }) => path === 'SKILL.md')) {
    const first = descriptors[0]?.path.split('/')[0];
    if (!first || !descriptors.some(({ path }) => path === `${first}/SKILL.md`)
      || descriptors.some(({ path }) => path.split('/')[0] !== first)) {
      throw new Error('skill_document_missing');
    }
    prefix = `${first}/`;
  }
  for (const descriptor of descriptors) {
    const relative = descriptor.path.slice(prefix.length);
    safeRelative(relative);
    const data = descriptor.entry.getData();
    if (data.byteLength !== descriptor.size || data.byteLength > MAX_BYTES) throw new Error('skill_archive_size_mismatch');
    const destination = ensureWithin(target, join(target, ...relative.split('/')), 'skill_quarantine_escape');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, data, { flag: 'wx', mode: 0o600 });
  }
}

export function createSkillInstaller({
  quarantineRoot,
  skillsRoot,
  confirmLocal,
  ids = randomUUID,
} = {}) {
  if (!quarantineRoot || !skillsRoot || typeof confirmLocal !== 'function') throw new TypeError('skill_installer_dependencies_required');
  const quarantine = resolve(quarantineRoot);
  const installed = resolve(skillsRoot);
  const rollbackRoot = join(dirname(installed), 'skill-rollback');
  const consumedConfirmations = new Set();
  const rollbacks = new Map();
  const nextId = () => String(typeof ids === 'function' ? ids() : ids.next());

  async function stage({ sourcePath } = {}) {
    if (typeof sourcePath !== 'string' || !sourcePath || /^https?:/iu.test(sourcePath)) throw new TypeError('skill_source_invalid');
    await Promise.all([mkdir(quarantine, { recursive: true }), mkdir(installed, { recursive: true })]);
    const quarantineId = nextId();
    if (!SAFE_ID.test(quarantineId)) throw new Error('skill_quarantine_id_invalid');
    const target = ensureWithin(quarantine, join(quarantine, quarantineId), 'skill_quarantine_escape');
    await mkdir(target, { recursive: false });
    try {
      const source = resolve(sourcePath);
      const stat = await lstat(source);
      if (stat.isSymbolicLink()) throw new Error('skill_reparse_point_forbidden');
      if (stat.isDirectory()) await copyFolder(source, target);
      else if (stat.isFile() && ['.zip', '.skill'].includes(extname(source).toLowerCase())) await extractZip(source, target);
      else throw new Error('skill_source_type_unsupported');
      const report = await auditSkillPackage({ directory: target });
      return Object.freeze({ quarantineId, report });
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      throw error;
    }
  }

  async function confirmed(action, refusedError) {
    const confirmation = await confirmLocal({ reason: 'Installer ou restaurer un skill Mina Vision audité.', action });
    if (!confirmation?.approved || typeof confirmation.token !== 'string' || !confirmation.token
      || confirmation.digest !== action.digest) throw new Error(refusedError);
    if (consumedConfirmations.has(confirmation.token)) throw new Error('skill_confirmation_reused');
    consumedConfirmations.add(confirmation.token);
  }

  async function install({ quarantineId } = {}) {
    if (!SAFE_ID.test(quarantineId ?? '')) throw new TypeError('skill_quarantine_id_invalid');
    const source = ensureWithin(quarantine, join(quarantine, quarantineId), 'skill_quarantine_escape');
    const report = await auditSkillPackage({ directory: source });
    if (report.licenseStatus === 'incompatible_agpl') throw new Error('skill_license_incompatible');
    if (!report.installable) throw new Error(`skill_audit_failed:${report.issues.join(',')}`);
    await confirmed({
      name: 'skill.install', digest: report.digest, skillName: report.name, version: report.version,
      capabilities: report.capabilities, scripts: report.scripts, dependencies: report.dependencies,
      licenseStatus: report.licenseStatus,
    }, 'skill_install_refused');
    const target = ensureWithin(installed, join(installed, report.name), 'skill_install_target_invalid');
    await mkdir(rollbackRoot, { recursive: true });
    let rollbackId = null;
    let backup = null;
    try {
      const existing = await lstat(target).catch(() => null);
      if (existing) {
        if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error('skill_install_target_invalid');
        rollbackId = `rollback-${nextId()}`;
        if (!SAFE_ID.test(rollbackId)) throw new Error('skill_rollback_id_invalid');
        const holder = ensureWithin(rollbackRoot, join(rollbackRoot, rollbackId), 'skill_rollback_escape');
        await mkdir(holder, { recursive: false });
        backup = join(holder, report.name);
        await rename(target, backup);
      }
      await rename(source, target);
      const loaded = await createSkillLoader({ root: installed }).load(report.name);
      if (loaded.digest !== report.digest) throw new Error('skill_install_postcheck_failed');
      if (backup) rollbacks.set(rollbackId, { name: report.name, backup });
      return Object.freeze({ installed: true, name: report.name, version: report.version, digest: report.digest, rollbackId });
    } catch (error) {
      const current = await lstat(target).catch(() => null);
      if (current) await rename(target, source).catch(() => {});
      if (backup) await rename(backup, target).catch(() => {});
      throw error;
    }
  }

  async function rollback({ name, rollbackId } = {}) {
    if (!SAFE_ID.test(name ?? '') || !SAFE_ID.test(rollbackId ?? '')) throw new TypeError('skill_rollback_invalid');
    const record = rollbacks.get(rollbackId);
    if (!record || record.name !== name) throw new Error('skill_rollback_unavailable');
    const target = ensureWithin(installed, join(installed, name), 'skill_install_target_invalid');
    const backupReport = await auditSkillPackage({ directory: record.backup });
    await confirmed({ name: 'skill.rollback', digest: backupReport.digest, skillName: name, version: backupReport.version }, 'skill_rollback_refused');
    const replacedId = `rollback-current-${nextId()}`;
    const replaced = ensureWithin(quarantine, join(quarantine, replacedId), 'skill_quarantine_escape');
    await rename(target, replaced);
    try {
      await rename(record.backup, target);
      const loaded = await createSkillLoader({ root: installed }).load(name);
      rollbacks.delete(rollbackId);
      return Object.freeze({ rolledBack: true, name, version: loaded.version, digest: loaded.digest });
    } catch (error) {
      await rename(target, record.backup).catch(() => {});
      await rename(replaced, target).catch(() => {});
      throw error;
    }
  }

  return Object.freeze({ stage, install, rollback });
}
