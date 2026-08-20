// Contrats déterministes de la navigation navigateur rapide (SPEC-MINA-BROWSER-001 §8). Modules PURS,
// NON câblés au runtime : ils décrivent une commande, un instantané, un résultat et une trace de
// performance, rien de plus. Sécurité structurelle : seul http/https est accepté (javascript:, data:,
// file: et schémas inconnus refusés) ; une requête ou une URL complète n'entre JAMAIS dans une trace
// de performance (au plus une origine ou un digest). Aucune supposition destructive : une commande
// ambiguë est marquée `ambiguous`, jamais devinée.

export const BROWSER_COMMAND_TYPES = Object.freeze([
  'open', 'navigate', 'search', 'back', 'forward', 'reload',
  'new_tab', 'close_tab', 'focus_tab', 'semantic_action', 'visual_mission', 'research',
]);
const COMMAND_TYPE_SET = new Set(BROWSER_COMMAND_TYPES);

export const BROWSER_SOURCES = Object.freeze(['voice', 'chat', 'ui', 'mission']);
export const BROWSER_ROUTES = Object.freeze(['fast', 'semantic', 'vision', 'research']);
export const SNAPSHOT_LEVELS = Object.freeze(['compact', 'semantic', 'vision', 'forensic']);

const READY_STATES = new Set(['loading', 'interactive', 'complete']);

// Réutilise la posture de action-normalizer : http/https uniquement, tout le reste rejeté.
export function normalizeBrowserUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('browser_url_invalid'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('browser_url_scheme_forbidden');
  return url.href;
}

function originOf(value) {
  try { return new URL(String(value)).origin; } catch { return null; }
}

export function normalizeBrowserCommand(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('browser_command_invalid');
  const type = String(input.type ?? '');
  if (!COMMAND_TYPE_SET.has(type)) throw new Error(`browser_command_type_invalid:${type}`);
  const source = BROWSER_SOURCES.includes(input.source) ? input.source : 'mission';

  const command = {
    commandId: String(input.commandId ?? '').trim() || null,
    source,
    type,
    deadlineMs: Number.isFinite(input.deadlineMs) && input.deadlineMs > 0 ? Math.min(input.deadlineMs, 900_000) : 30_000,
    requestedAt: Number.isFinite(input.requestedAt) ? input.requestedAt : 0,
    ambiguous: input.ambiguous === true,
  };
  if (!command.commandId) throw new Error('browser_command_id_required'); // sert à la déduplication

  if (type === 'navigate' || type === 'open' || type === 'new_tab') {
    if (input.targetUrl) command.targetUrl = normalizeBrowserUrl(input.targetUrl);
  }
  if (type === 'search') {
    command.query = String(input.query ?? ''); // jamais journalisée en clair (voir trace)
    command.searchEngine = input.searchEngine ? String(input.searchEngine) : 'google';
    if (!command.query.trim()) throw new Error('browser_command_query_required');
  }
  if (type === 'semantic_action') {
    command.semanticTarget = input.semanticTarget ? Object.freeze({ ...input.semanticTarget }) : null;
  }
  return Object.freeze(command);
}

export function normalizeBrowserSnapshot(input = {}, level = 'compact') {
  if (!SNAPSHOT_LEVELS.includes(level)) throw new Error(`browser_snapshot_level_invalid:${level}`);
  const base = {
    level,
    pageId: String(input.pageId ?? ''),
    navigationId: String(input.navigationId ?? ''),
    url: input.url ? String(input.url) : null,
    origin: input.url ? originOf(input.url) : null,
    title: input.title ? String(input.title) : null,
    readyState: READY_STATES.has(input.readyState) ? input.readyState : null,
    visibilityState: input.visibilityState === 'hidden' ? 'hidden' : 'visible',
    focusedElement: input.focusedElement ? String(input.focusedElement).slice(0, 200) : null,
    capturedAt: Number.isFinite(input.capturedAt) ? input.capturedAt : 0,
  };
  // Les niveaux enrichissent progressivement — jamais l'inverse (compact ne porte ni image ni DOM).
  if (level === 'semantic' || level === 'vision' || level === 'forensic') {
    base.elements = Object.freeze(Array.isArray(input.elements) ? input.elements.slice(0, 120) : []);
  }
  if (level === 'vision' || level === 'forensic') {
    base.imageDigest = input.imageDigest ? String(input.imageDigest) : null;
    base.imageBase64 = input.imageBase64 ? String(input.imageBase64) : null; // fourni seulement si un fournisseur l'exige
  }
  return Object.freeze(base);
}

export function createBrowserActionResult(input = {}) {
  const route = BROWSER_ROUTES.includes(input.route) ? input.route : 'fast';
  // `attempted` et `verified` restent DISTINCTS : une action lancée n'est jamais annoncée réussie
  // sans preuve (§8.3). verified=true exige un verificationReason.
  const verified = input.verified === true;
  if (verified && !input.verificationReason) throw new Error('browser_result_verification_reason_required');
  return Object.freeze({
    commandId: String(input.commandId ?? ''),
    route,
    action: input.action ? String(input.action) : null,
    attempted: input.attempted === true,
    verified,
    verificationReason: input.verificationReason ? String(input.verificationReason) : null,
    pageId: input.pageId ? String(input.pageId) : null,
    navigationId: input.navigationId ? String(input.navigationId) : null,
    resultUrl: input.resultUrl ? String(input.resultUrl) : null,
    recoveryCount: Number.isFinite(input.recoveryCount) && input.recoveryCount >= 0 ? Math.floor(input.recoveryCount) : 0,
    timings: Object.freeze({ ...(input.timings ?? {}) }),
    errorCode: input.errorCode ? String(input.errorCode) : null,
  });
}

// Trace de performance : JAMAIS de texte, URL complète, capture, DOM ni secret (§8.4, §21). On garde
// des NOMBRES et des étiquettes ; une URL est réduite à son origine, une requête est effacée.
export function createBrowserPerformanceSpan(input = {}) {
  return Object.freeze({
    correlationId: String(input.correlationId ?? ''),
    commandId: String(input.commandId ?? ''),
    route: BROWSER_ROUTES.includes(input.route) ? input.route : 'fast',
    phase: String(input.phase ?? 'unknown'),
    providerId: input.providerId ? String(input.providerId) : null,
    modelId: input.modelId ? String(input.modelId) : null,
    durationMs: Number.isFinite(input.durationMs) && input.durationMs >= 0 ? input.durationMs : 0,
    payloadBytes: Number.isFinite(input.payloadBytes) ? input.payloadBytes : null,
    imageBytes: Number.isFinite(input.imageBytes) ? input.imageBytes : null,
    elementCount: Number.isFinite(input.elementCount) ? input.elementCount : null,
    origin: input.url ? originOf(input.url) : (input.origin ? String(input.origin) : null),
    status: input.status ? String(input.status) : 'ok',
    timeout: input.timeout === true,
    fallback: input.fallback === true,
    recordedAt: Number.isFinite(input.recordedAt) ? input.recordedAt : 0,
  });
}
