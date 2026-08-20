// Routeur d'intention navigateur DÉTERMINISTE (SPEC-MINA-BROWSER-001 §9). Classe une formulation
// française vers la voie la moins coûteuse : FAST (URL, recherche, historique, onglets), SEMANTIC
// (locators DOM), VISION (canvas), RESEARCH (info web sans navigateur visible). ZÉRO appel LLM. Une
// formulation ambiguë (§9.3) est marquée `ambiguous` et n'est JAMAIS devinée de façon destructive.
// Module PUR, non câblé au runtime.

import { normalizeBrowserCommand } from './browser-contracts.mjs';

function normalize(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/gu, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/['’-]/gu, ' ') // apostrophes ET tirets → espace (« trouve-moi » = « trouve moi »)
    .replace(/[^a-z0-9:./?=&_]/gu, ' ') // garde ce qui sert aux URLs (: / . ? = & _), le reste = espace
    .replace(/\s+/gu, ' ')
    .trim();
}

// Domaine nu (label.tld) ou URL explicite. Exclut « sais-tu » (pas de TLD) mais capte « wikipedia.org ».
const URL_TOKEN = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)\b/u;
const BARE_DOMAIN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?$/u;

const HISTORY = [
  { type: 'back', re: /\b(reviens|retour|reviens en arriere|page precedente|precedent)\b/u },
  { type: 'forward', re: /\b(avance|page suivante|va en avant)\b/u },
  { type: 'reload', re: /\b(actualise|rafraichis|rafraichit|recharge|reload|rafraichir)\b/u },
];
const NEW_TAB = /\b(nouvel? onglet|nouvelle page|ouvre un onglet|ajoute un onglet)\b/u;
const CLOSE_TAB = /\b(ferme (cet |l |cette )?(onglet|page)|ferme l onglet)\b/u;
const SEARCH_VERB = /\b(cherche|recherche|google|recherche moi)\b/u;
const RESEARCH = /\b(trouve moi|trouve|donne moi) (des )?(info|infos|informations|renseignements)\b/u;
const NO_BROWSER = /\bsans (ouvrir|lancer) (le )?(navigateur|chrome|google)\b/u;
const OPEN_BROWSER = /\bouvre (le |mon )?(navigateur|chrome|google chrome)\b/u;
const CANVAS = /\b(canvas|sur la carte|cette carte|le plan|la carte interactive)\b/u;
const SEMANTIC = [
  { action: 'click', re: /\bclique(z)? sur\b/u },
  { action: 'fill', re: /\b(ecris|ecrit|tape|saisis|remplis|met|mets)\b.*\bdans\b/u },
  { action: 'check', re: /\bcoche(z)?\b/u },
  { action: 'uncheck', re: /\bdecoche(z)?\b/u },
  { action: 'select', re: /\b(choisis|selectionne|selectionner)\b/u },
];

function stripSearchLead(normalized) {
  return normalized
    .replace(/^.*\b(cherche|recherche moi|recherche)\b/u, '') // GREEDY jusqu'au dernier verbe de recherche
    .replace(/\bdans (le |mon )?(navigateur|chrome|google)\b/u, '')
    .replace(/\bsur (le )?(web|internet|google)\b/u, '')
    .replace(/\bsans (ouvrir|lancer) (le )?(navigateur|chrome|google)\b/u, '')
    .replace(/[.\s]+$/u, '') // ponctuation/espaces de fin
    .trim();
}

// Classe l'énoncé. Retourne { type, route, ...champs } ou { type:'ambiguous', reason } ou null.
export function classifyBrowserUtterance(utterance) {
  const n = normalize(utterance);
  if (!n) return null;

  if (/\bfais le necessaire\b/u.test(n)) return { type: 'ambiguous', route: null, reason: 'objectif_non_observable' };

  for (const { type, re } of HISTORY) if (re.test(n)) return { type, route: 'fast' };
  if (CLOSE_TAB.test(n)) return { type: 'close_tab', route: 'fast' };
  if (NEW_TAB.test(n)) {
    const url = n.match(URL_TOKEN)?.[1];
    return url ? { type: 'new_tab', route: 'fast', targetUrl: withScheme(url) } : { type: 'new_tab', route: 'fast' };
  }

  // Verbes d'interaction DOM d'abord : « écris X dans le champ de recherche » est un fill, pas une
  // recherche (le mot « recherche » y est le nom du champ, pas la commande).
  for (const { action, re } of SEMANTIC) if (re.test(n)) return { type: 'semantic_action', route: 'semantic', semanticAction: action };
  if (CANVAS.test(n)) return { type: 'visual_mission', route: 'vision' };

  // Recherche documentaire (info) OU recherche visible « sans ouvrir Chrome » → RESEARCH.
  if (RESEARCH.test(n) || (SEARCH_VERB.test(n) && NO_BROWSER.test(n))) {
    return { type: 'research', route: 'research', query: stripSearchLead(n) || n };
  }

  if (SEARCH_VERB.test(n)) {
    const query = stripSearchLead(n);
    if (!query) return { type: 'ambiguous', route: null, reason: 'requete_vide' };
    // « cherche example.com » : ressemble à la fois à un domaine et à une requête → ambigu (§9.3).
    if (BARE_DOMAIN.test(query)) return { type: 'ambiguous', route: null, reason: 'domaine_ou_requete' };
    return { type: 'search', route: 'fast', query, searchEngine: 'google' };
  }

  // Navigation : une URL/domaine explicite (« va sur X », « ouvre https://X »).
  const urlMatch = n.match(URL_TOKEN);
  if (urlMatch && /\b(va sur|ouvre|navigue|rends toi sur|aller sur|va a)\b/u.test(n)) {
    return { type: 'navigate', route: 'fast', targetUrl: withScheme(urlMatch[1]) };
  }

  if (OPEN_BROWSER.test(n)) return { type: 'open', route: 'fast' };

  return null; // pas une commande navigateur déterministe
}

function withScheme(token) {
  return /^https?:\/\//u.test(token) ? token : `https://${token}`;
}

function buildSearchUrl(query, engine) {
  const q = encodeURIComponent(String(query).trim());
  if (engine === 'bing') return `https://www.bing.com/search?q=${q}`;
  if (engine === 'duckduckgo') return `https://duckduckgo.com/?q=${q}`;
  return `https://www.google.com/search?q=${q}`;
}

// Construit la BrowserCommand normalisée à partir d'un énoncé. Retourne null si non-navigateur.
// Une recherche visible construit directement l'URL du moteur (jamais de saisie dans la barre).
export function routeBrowserCommand(utterance, { commandId, source = 'voice', requestedAt = 0, deadlineMs } = {}) {
  const hit = classifyBrowserUtterance(utterance);
  if (!hit) return null;
  if (hit.type === 'ambiguous') {
    return Object.freeze({ ambiguous: true, reason: hit.reason, route: null });
  }
  const payload = { commandId: commandId ?? `browser-${requestedAt}`, source, type: hit.type, requestedAt, deadlineMs };
  if (hit.targetUrl) payload.targetUrl = hit.targetUrl;
  if (hit.type === 'search') {
    payload.query = hit.query;
    payload.searchEngine = hit.searchEngine;
    const command = normalizeBrowserCommand(payload);
    return Object.freeze({ ...command, route: 'fast', searchUrl: buildSearchUrl(hit.query, hit.searchEngine) });
  }
  if (hit.type === 'semantic_action') payload.semanticTarget = { action: hit.semanticAction };
  const command = normalizeBrowserCommand(payload);
  return Object.freeze({ ...command, route: hit.route, semanticAction: hit.semanticAction ?? null });
}
