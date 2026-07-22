// Moteur de diff/patch : diff unifié (bibliothèque « diff », éprouvée par Jest/Mocha) et format
// de patch Mina inspiré d'apply_patch (ancrage par contexte, pas par numéros de ligne).
//
// Format Mina :
//   *** Begin Patch
//   *** Update File: chemin/fichier.mjs
//    ligne de contexte
//   -ligne supprimée
//   +ligne ajoutée
//   *** Add File: nouveau.mjs
//   +contenu
//   *** Delete File: obsolete.mjs
//   *** End Patch

import { structuredPatch } from 'diff';

const BEGIN = '*** Begin Patch';
const END = '*** End Patch';
const FILE_MARKERS = Object.freeze([
  { prefix: '*** Update File: ', operation: 'update' },
  { prefix: '*** Add File: ', operation: 'add' },
  { prefix: '*** Delete File: ', operation: 'delete' },
]);

export function parseMinaPatch(patchText) {
  const text = String(patchText ?? '');
  const lines = text.split(/\r?\n/u);
  const beginIndex = lines.findIndex((line) => line.trim() === BEGIN);
  const endIndex = lines.findIndex((line) => line.trim() === END);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    throw new Error('code_diff_patch_invalid: marqueurs Begin/End Patch absents');
  }
  const files = [];
  let current = null;
  let hunk = null;

  const closeHunk = () => {
    if (hunk && (hunk.removals.length > 0 || hunk.additions.length > 0)) current.hunks.push(hunk);
    hunk = null;
  };
  const closeFile = () => {
    if (!current) return;
    closeHunk();
    if (current.operation === 'update' && current.hunks.length === 0) {
      throw new Error(`code_diff_patch_invalid: aucune modification pour ${current.file}`);
    }
    files.push(Object.freeze({ ...current, hunks: Object.freeze(current.hunks.map((entry) => Object.freeze(entry))) }));
    current = null;
  };

  for (const rawLine of lines.slice(beginIndex + 1, endIndex)) {
    const marker = FILE_MARKERS.find(({ prefix }) => rawLine.startsWith(prefix));
    if (marker) {
      closeFile();
      const file = rawLine.slice(marker.prefix.length).trim();
      if (!file) throw new Error('code_diff_patch_invalid: chemin de fichier vide');
      current = { file, operation: marker.operation, hunks: [] };
      continue;
    }
    if (!current) {
      if (rawLine.trim() === '') continue;
      throw new Error(`code_diff_patch_invalid: ligne hors section fichier « ${rawLine.slice(0, 40)} »`);
    }
    if (rawLine.startsWith('@@')) {
      closeHunk();
      continue;
    }
    hunk ??= { context: [], removals: [], additions: [], sequence: [] };
    if (rawLine.startsWith('+')) {
      hunk.additions.push(rawLine.slice(1));
      hunk.sequence.push({ kind: 'add', line: rawLine.slice(1) });
    } else if (rawLine.startsWith('-')) {
      hunk.removals.push(rawLine.slice(1));
      hunk.sequence.push({ kind: 'remove', line: rawLine.slice(1) });
    } else {
      const contextLine = rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine;
      hunk.context.push(contextLine);
      hunk.sequence.push({ kind: 'context', line: contextLine });
    }
  }
  closeFile();
  if (files.length === 0) throw new Error('code_diff_patch_invalid: aucun fichier dans le patch');
  return Object.freeze(files);
}

// Applique un hunk par ancrage de contexte : la séquence contexte+suppressions doit apparaître
// EXACTEMENT UNE fois dans le fichier — zéro occurrence ou plusieurs → erreur nominée.
export function applyHunksToContent(content, hunks, filePath = 'fichier') {
  let lines = String(content).split('\n');
  for (const hunkEntry of hunks) {
    const needle = hunkEntry.sequence
      .filter((entry) => entry.kind !== 'add')
      .map((entry) => entry.line);
    if (needle.length === 0) {
      lines = [...lines, ...hunkEntry.additions];
      continue;
    }
    const matches = [];
    for (let index = 0; index <= lines.length - needle.length; index += 1) {
      if (needle.every((line, offset) => lines[index + offset] === line)) matches.push(index);
    }
    if (matches.length === 0) {
      throw new Error(`code_diff_apply_context_not_found: ${filePath} — « ${needle[0]?.slice(0, 60) ?? ''} »`);
    }
    if (matches.length > 1) {
      throw new Error(`code_diff_apply_ambiguous: ${filePath} — ${matches.length} occurrences du contexte`);
    }
    const start = matches[0];
    const replacement = [];
    let cursor = start;
    for (const entry of hunkEntry.sequence) {
      if (entry.kind === 'context') {
        replacement.push(lines[cursor]);
        cursor += 1;
      } else if (entry.kind === 'remove') {
        cursor += 1;
      } else {
        replacement.push(entry.line);
      }
    }
    lines = [...lines.slice(0, start), ...replacement, ...lines.slice(start + needle.length)];
  }
  return lines.join('\n');
}

export function createDiffEngine({ fs = null, fileBackup = null } = {}) {
  const requireFs = () => {
    if (!fs || typeof fs.readFile !== 'function' || typeof fs.writeFile !== 'function') {
      throw new Error('code_diff_fs_required');
    }
  };

  function diff({ original, modified, filePath = 'fichier' } = {}) {
    const patch = structuredPatch(filePath, filePath, String(original ?? ''), String(modified ?? ''), '', '');
    let additions = 0;
    let deletions = 0;
    for (const hunkEntry of patch.hunks) {
      for (const line of hunkEntry.lines) {
        if (line.startsWith('+')) additions += 1;
        else if (line.startsWith('-')) deletions += 1;
      }
    }
    return Object.freeze({
      filePath,
      hunks: Object.freeze(patch.hunks.map((entry) => Object.freeze({ ...entry, lines: Object.freeze([...entry.lines]) }))),
      additions,
      deletions,
    });
  }

  function formatUnified(diffResult) {
    const lines = [`--- a/${diffResult.filePath}`, `+++ b/${diffResult.filePath}`];
    for (const hunkEntry of diffResult.hunks) {
      lines.push(`@@ -${hunkEntry.oldStart},${hunkEntry.oldLines} +${hunkEntry.newStart},${hunkEntry.newLines} @@`);
      lines.push(...hunkEntry.lines);
    }
    return lines.join('\n');
  }

  async function validatePatch({ patch } = {}) {
    let parsed;
    try {
      parsed = parseMinaPatch(patch);
    } catch (error) {
      return Object.freeze({ valid: false, errors: Object.freeze([error.message]) });
    }
    const errors = [];
    if (fs) {
      for (const entry of parsed) {
        if (entry.operation !== 'update') continue;
        try {
          const content = String(await fs.readFile(entry.file, 'utf8'));
          applyHunksToContent(content, entry.hunks, entry.file);
        } catch (error) {
          errors.push(error.message);
        }
      }
    }
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), files: parsed.map((entry) => entry.file) });
  }

  async function applyPatch({ patch, backup = true } = {}) {
    requireFs();
    const parsed = parseMinaPatch(patch);
    const applied = [];
    try {
      for (const entry of parsed) {
        if (entry.operation === 'delete') {
          if (backup && fileBackup) await fileBackup.backup(entry.file);
          await fs.rm(entry.file, { force: false });
          applied.push({ file: entry.file, operation: 'delete' });
          continue;
        }
        if (entry.operation === 'add') {
          const content = entry.hunks.flatMap((hunkEntry) => hunkEntry.additions).join('\n');
          await fs.writeFile(entry.file, content, 'utf8');
          applied.push({ file: entry.file, operation: 'add' });
          continue;
        }
        const original = String(await fs.readFile(entry.file, 'utf8'));
        const next = applyHunksToContent(original, entry.hunks, entry.file);
        if (backup && fileBackup) await fileBackup.backup(entry.file);
        await fs.writeFile(entry.file, next, 'utf8');
        applied.push({ file: entry.file, operation: 'update' });
      }
    } catch (error) {
      // Rollback de tout ce qui a été appliqué avant l'échec — le patch est atomique.
      if (fileBackup) {
        for (const entry of [...applied].reverse()) {
          if (entry.operation !== 'add' && fileBackup.hasBackup(entry.file)) {
            await fileBackup.restore(entry.file).catch(() => {});
          }
        }
      }
      throw new Error(`code_diff_apply_failed: ${error.message}`);
    }
    return Object.freeze({ applied: Object.freeze(applied.map((entry) => Object.freeze(entry))) });
  }

  async function revertLastPatch(filePath) {
    if (!fileBackup) throw new Error('code_diff_backup_required');
    return fileBackup.restore(filePath);
  }

  return Object.freeze({ diff, formatUnified, parseMinaPatch, applyHunksToContent, validatePatch, applyPatch, revertLastPatch });
}
