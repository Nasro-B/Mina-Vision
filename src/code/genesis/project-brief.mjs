import path from 'node:path';

// Genèse T1.1 (SPEC agente-codage V1) : normalise un brief de projet AVANT toute écriture. Un prompt libre
// (« crée une API Fastify avec auth JWT ») est d'abord transformé en brief structuré par le LLM en amont ;
// ce module VALIDE et NORMALISE ce brief, puis `describeBrief` le rend lisible pour le montrer à Nasro
// (« voilà ce que je vais construire ») avant la moindre écriture disque. Refus net d'une cible hors des
// racines d'écriture autorisées (jamais d'écriture hors périmètre). PUR : aucune I/O, aucun LLM ici.

export const PROJECT_TYPES = Object.freeze(['api', 'web', 'cli', 'lib', 'electron', 'mobile']);
const NAME_MAX = 64;
const FEATURES_MAX = 20;
const FEATURE_LEN_MAX = 120;

function sanitizeName(value) {
  const name = String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/gu, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, NAME_MAX);
  return name;
}

function normalizeFeatures(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  return Object.freeze(list
    .map((f) => String(f ?? '').trim().slice(0, FEATURE_LEN_MAX))
    .filter(Boolean)
    .slice(0, FEATURES_MAX));
}

// La cible DOIT être strictement à l'intérieur d'une racine autorisée (jamais la racine elle-même nue si
// on veut, mais surtout jamais au-dessus/à côté). Compare des chemins RÉSOLUS avec séparateur final pour
// éviter que `/racineX` matche `/racine`.
export function isWithinAllowedRoots(target, allowedRoots = []) {
  if (!target || !Array.isArray(allowedRoots) || allowedRoots.length === 0) return false;
  const resolvedTarget = path.resolve(String(target));
  return allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(String(root));
    if (resolvedTarget === resolvedRoot) return true;
    const withSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    return resolvedTarget.startsWith(withSep);
  });
}

export function normalizeProjectBrief(input = {}, { allowedRoots = [] } = {}) {
  const name = sanitizeName(input.name);
  if (!name) throw new Error('project_brief_name_required');
  const targetDir = input.targetDir ? path.resolve(String(input.targetDir)) : null;
  if (!targetDir) throw new Error('project_brief_target_required');
  if (!isWithinAllowedRoots(targetDir, allowedRoots)) throw new Error('project_brief_target_outside_roots');

  return Object.freeze({
    name,
    // Type inconnu → null (jamais inventé) : l'appelant DEMANDE à Nasro, il ne devine pas.
    type: PROJECT_TYPES.includes(input.type) ? input.type : null,
    stack: String(input.stack ?? '').trim().slice(0, 80) || null,
    features: normalizeFeatures(input.features),
    constraints: normalizeFeatures(input.constraints),
    targetDir,
  });
}

// Rendu lisible montré à Nasro AVANT écriture (voix + UI). Honnête : dit ce qui manque (type/stack).
export function describeBrief(brief) {
  const type = brief.type ?? 'type à préciser';
  const stack = brief.stack ?? 'stack à préciser';
  const features = brief.features.length ? brief.features.join(', ') : 'aucune fonctionnalité listée';
  return `Je vais construire « ${brief.name} » (${type}), stack ${stack}, avec : ${features}. Dossier : ${brief.targetDir}.`;
}
