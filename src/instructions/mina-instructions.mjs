import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MAX_BYTES = 128 * 1024;
export const REQUIRED_MINA_SECTIONS = Object.freeze([
  'Sécurité immuable',
  'Identité',
  'Rôle',
  'Ordre d’autorité',
  'Grounding',
  'Actions et confirmations',
  'Canaux',
  'Mémoire et secrets',
  'Skills',
  'Sandbox',
  'Sessions',
  'Arrêt d’urgence',
]);

const SECRET_ASSIGNMENT = /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|client[_ -]?secret|private[_ -]?key)\s*[:=]\s*["']?[^\s"']{8,}/iu;
const SECRET_PATH = /(?:[a-z]:\\|\/)[^\r\n]{0,240}(?:keyring(?:\.json|\.sqlite)?|\.mina[\\/](?:secrets?|keyring))/iu;
const IMMUTABLE_OVERRIDE = /(?:ignore|ignorer|annule|annuler|désactive|désactiver|desactive|desactiver|contourne|contourner|supprime|supprimer).{0,100}(?:sécurité immuable|securite immuable|confirmation|capability broker|arrêt d’urgence|arret d'urgence)/iu;

function headingsOf(content) {
  return [...content.matchAll(/^##\s+(.+?)\s*$/gmu)].map((match) => match[1]);
}

export function validateMinaInstructions(content) {
  if (typeof content !== 'string') throw new TypeError('mina_instructions_invalid');
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) throw new Error('mina_instructions_too_large');
  if (!/^#\s+Mina Vision\s*$/mu.test(content)) throw new Error('mina_instructions_title_invalid');
  const versionMatch = content.match(/^Version:\s*(\d+)\s*$/mu);
  const version = Number(versionMatch?.[1]);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('mina_instructions_version_invalid');
  const headings = headingsOf(content);
  for (const required of REQUIRED_MINA_SECTIONS) {
    if (!headings.includes(required)) throw new Error(`mina_instructions_section_missing:${required}`);
  }
  const positions = REQUIRED_MINA_SECTIONS.map((section) => headings.indexOf(section));
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    throw new Error('mina_instructions_section_order_invalid');
  }
  if (new Set(headings).size !== headings.length) throw new Error('mina_instructions_section_duplicate');
  if (IMMUTABLE_OVERRIDE.test(content)) throw new Error('mina_instructions_immutable_override');
  if (SECRET_ASSIGNMENT.test(content)) throw new Error('mina_instructions_secret_forbidden');
  if (SECRET_PATH.test(content)) throw new Error('mina_instructions_secret_path_forbidden');
  return Object.freeze({ version, sections: Object.freeze([...headings]) });
}

export async function loadMinaInstructions({ filename } = {}) {
  const absolute = resolve(filename ?? 'MINA.md');
  let bytes;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    throw new Error('mina_instructions_unavailable', { cause: error });
  }
  if (bytes.byteLength > MAX_BYTES) throw new Error('mina_instructions_too_large');
  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error('mina_instructions_invalid_utf8', { cause: error });
  }
  const validated = validateMinaInstructions(content);
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  return Object.freeze({
    filename: absolute,
    version: validated.version,
    digest,
    sections: validated.sections,
    content,
    sessionSnapshot: () => Object.freeze({ version: validated.version, digest }),
  });
}
