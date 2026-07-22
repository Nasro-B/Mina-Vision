import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { loadMinaInstructions, validateMinaInstructions } from './mina-instructions.mjs';

const PROPOSAL_KEYS = Object.freeze(['baseDigest', 'rationale', 'risk', 'unifiedDiff']);
const RISKS = new Set(['low', 'medium', 'high']);

function digest(content) {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function validateProposal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...PROPOSAL_KEYS])) {
    throw new TypeError('instruction_change_proposal_invalid');
  }
  if (typeof value.baseDigest !== 'string' || value.baseDigest.length > 100
    || typeof value.unifiedDiff !== 'string' || value.unifiedDiff.length < 1 || Buffer.byteLength(value.unifiedDiff) > 128 * 1024
    || typeof value.rationale !== 'string' || value.rationale.length < 1 || value.rationale.length > 4_000
    || !RISKS.has(value.risk)) {
    throw new TypeError('instruction_change_proposal_invalid');
  }
  return value;
}

function validTarget(header, prefix) {
  const match = header.match(new RegExp(`^${prefix}\\s+([^\\t]+)(?:\\t.*)?$`, 'u'));
  return match && ['MINA.md', `a/MINA.md`, `b/MINA.md`].includes(match[1]);
}

export function applyUnifiedMinaDiff(content, unifiedDiff) {
  const diffLines = unifiedDiff.replaceAll('\r\n', '\n').split('\n');
  if (!validTarget(diffLines[0] ?? '', '---') || !validTarget(diffLines[1] ?? '', '\\+\\+\\+')) {
    throw new Error('instruction_change_target_invalid');
  }
  if (diffLines.slice(2).some((line) => line.startsWith('--- ') || line.startsWith('+++ '))) {
    throw new Error('instruction_change_target_invalid');
  }
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const source = content.split(/\r?\n/u);
  const output = [];
  let sourceIndex = 0;
  let index = 2;
  let hunks = 0;
  while (index < diffLines.length && diffLines[index] === '') index += 1;
  while (index < diffLines.length) {
    const header = diffLines[index].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u);
    if (!header) throw new Error('instruction_change_diff_invalid');
    const oldStart = Number(header[1]);
    const oldCount = Number(header[2] ?? 1);
    const newCount = Number(header[4] ?? 1);
    if (!Number.isSafeInteger(oldStart) || oldStart < 1 || oldStart - 1 < sourceIndex) throw new Error('instruction_change_diff_invalid');
    output.push(...source.slice(sourceIndex, oldStart - 1));
    sourceIndex = oldStart - 1;
    index += 1;
    let consumed = 0;
    let produced = 0;
    while (index < diffLines.length && !diffLines[index].startsWith('@@ ')) {
      const line = diffLines[index];
      if (line === '' && index === diffLines.length - 1) {
        index += 1;
        break;
      }
      const marker = line[0];
      const value = line.slice(1);
      if (marker === ' ' || marker === '-') {
        if (source[sourceIndex] !== value) throw new Error('instruction_change_diff_mismatch');
        if (marker === ' ') output.push(value);
        sourceIndex += 1;
        consumed += 1;
        if (marker === ' ') produced += 1;
      } else if (marker === '+') {
        output.push(value);
        produced += 1;
      } else if (line !== '\\ No newline at end of file') {
        throw new Error('instruction_change_diff_invalid');
      }
      index += 1;
    }
    if (consumed !== oldCount || produced !== newCount) throw new Error('instruction_change_diff_count_invalid');
    hunks += 1;
  }
  if (!hunks) throw new Error('instruction_change_diff_invalid');
  output.push(...source.slice(sourceIndex));
  return output.join(eol);
}

export async function writeInstructionAtomic(filename, content, idFactory = randomUUID) {
  const absolute = resolve(filename);
  const temporary = join(dirname(absolute), `.${basename(absolute)}.${idFactory()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, absolute);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export function createInstructionChangeService({
  filename,
  confirmLocal,
  history,
  instructionLoader = loadMinaInstructions,
  atomicWriter = writeInstructionAtomic,
  clock = Date.now,
} = {}) {
  if (!filename || typeof confirmLocal !== 'function' || !history?.writeEncrypted
    || typeof instructionLoader !== 'function' || typeof atomicWriter !== 'function') {
    throw new TypeError('instruction_change_dependencies_required');
  }
  const absolute = resolve(filename);
  const consumedConfirmations = new Set();

  async function apply(value) {
    const proposal = validateProposal(value);
    const current = await instructionLoader({ filename: absolute });
    if (proposal.baseDigest !== current.digest) throw new Error('instruction_change_stale');
    const proposedContent = applyUnifiedMinaDiff(current.content, proposal.unifiedDiff);
    validateMinaInstructions(proposedContent);
    const proposedDigest = digest(proposedContent);
    const confirmation = await confirmLocal({
      reason: 'Modifier les instructions constitutionnelles de Mina Vision.',
      action: {
        name: 'instructions.change',
        baseDigest: current.digest,
        proposedDigest,
        unifiedDiff: proposal.unifiedDiff,
        rationale: proposal.rationale,
        risk: proposal.risk,
      },
    });
    if (!confirmation?.approved || typeof confirmation.token !== 'string' || !confirmation.token
      || confirmation.baseDigest !== current.digest || confirmation.proposedDigest !== proposedDigest) {
      throw new Error('instruction_change_confirmation_invalid');
    }
    if (consumedConfirmations.has(confirmation.token)) throw new Error('instruction_change_confirmation_reused');
    consumedConfirmations.add(confirmation.token);
    await history.writeEncrypted({
      type: 'mina_instruction_backup',
      id: `${current.digest}:${Number(typeof clock === 'function' ? clock() : clock.now())}`,
      value: { content: current.content, digest: current.digest, version: current.version },
    });
    await atomicWriter(absolute, proposedContent);
    try {
      const loaded = await instructionLoader({ filename: absolute });
      if (loaded.digest !== proposedDigest) throw new Error('instruction_change_postwrite_digest_mismatch');
      return Object.freeze({ applied: true, previousDigest: current.digest, digest: loaded.digest, version: loaded.version });
    } catch (error) {
      await atomicWriter(absolute, current.content);
      throw new Error('instruction_change_rolled_back', { cause: error });
    }
  }

  return Object.freeze({ apply });
}
