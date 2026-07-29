// Cercles de maturité des domaines (plan de durcissement T0.1/T0.2).
//
// Décision Nasro du 2026-07-28 (consignée au CHANGELOG). Chaque domaine appartient à UN cercle qui
// fixe ce qu'on lui demande — et ce qu'on affiche à son sujet. C'est une propriété STATIQUE du
// domaine, orthogonale à son état runtime (available/degraded/unavailable) : un domaine CŒUR peut
// être momentanément indisponible, un domaine GELÉ peut marcher — le cercle dit la maturité, pas la
// disponibilité de l'instant.
//
// Trois cercles :
//   - coeur    : à finir à 100 %, prouvé en usage réel ;
//   - maintenu : marche, gelé en fonctionnalités — correctifs seulement ;
//   - gele     : expérimental, NON vérifié en usage réel — affiché tel quel, sans le cacher.
//
// Règle de classement pour les domaines que la décision ne nomme pas explicitement (gouvernance,
// sauvegarde, personnalité) : défaut au cercle GELÉ. C'est le choix honnête — marquer « non vérifié »
// sous-promet au lieu de sur-promettre. Reclassement = décision Nasro, pas une supposition d'ici.

export const CIRCLES = Object.freeze({
  coeur: Object.freeze({
    id: 'coeur',
    label: 'Cœur',
    note: 'domaine central, finalisé et vérifié en usage réel',
    experimental: false,
  }),
  maintenu: Object.freeze({
    id: 'maintenu',
    label: 'Maintenu',
    note: 'fonctionnel, gelé en fonctionnalités — correctifs de sécurité et de bugs seulement',
    experimental: false,
  }),
  gele: Object.freeze({
    id: 'gele',
    label: 'Expérimental',
    note: 'expérimental — non vérifié en usage réel',
    experimental: true,
  }),
});

export const DEFAULT_CIRCLE = 'gele';

// Table explicite domaine → cercle. Les clés couvrent les identifiants réellement publiés au
// catalogue runtime (`reportCapability(...)` dans src/ui/main.mjs) ET les identifiants de capacités
// permanentes du brief (src/core/capability-catalog.mjs). Toute divergence est un échec de test
// (tests/domain-circles.test.mjs) : la table doit rester exhaustive quand un domaine apparaît.
const DOMAIN_CIRCLES = Object.freeze({
  // CŒUR — voix/conversation, missions navigateur, bureau Windows, mémoire/coffre, diagnostic.
  voice: 'coeur',
  'voice.local_only': 'gele',
  'computer_use.browser': 'coeur',
  'computer_use.desktop': 'coeur',
  missions_browser: 'coeur',
  missions_desktop: 'coeur',
  memory: 'coeur',
  journal: 'coeur',
  diagnostic: 'coeur',

  // MAINTENU — Android/chat, agent de code, documents PDF/DOCX.
  'computer_use.android': 'maintenu',
  missions_mobile: 'maintenu',
  camera: 'maintenu',
  code: 'maintenu',
  documents: 'maintenu',
  skills: 'maintenu',

  // GELÉ / EXPÉRIMENTAL — nommés par la décision.
  mail: 'gele',
  home: 'gele',
  personal: 'gele',
  'biometrics.face': 'gele',
  telegram: 'gele',
  sandbox: 'gele',
  printing: 'gele',
  'avatar.visage': 'gele',
  'packaging.local_voice': 'gele',
  // GELÉ / EXPÉRIMENTAL — non nommés par la décision, défaut conservateur (à reclasser par Nasro).
  personality: 'gele',
  backup: 'gele',
  automation: 'gele',
  recovery: 'gele',
  evaluation: 'gele',
  emergency: 'gele',
  approvals: 'gele',
  connectors: 'gele',
});

// Le cercle d'un domaine. Un identifiant inconnu retombe sur le défaut GELÉ plutôt que de lever :
// un domaine nouveau non classé doit apparaître « expérimental » à l'écran, jamais faire planter
// l'affichage du catalogue. Le contrat de test, lui, refuse qu'un domaine réel reste inconnu.
export function circleOf(domainId) {
  const key = typeof domainId === 'string' ? domainId : '';
  return DOMAIN_CIRCLES[key] ?? DEFAULT_CIRCLE;
}

export function describeCircle(domainId) {
  return CIRCLES[circleOf(domainId)];
}

export function isExperimental(domainId) {
  return describeCircle(domainId).experimental;
}

// Vue en lecture seule de la table complète, pour les tests et le diagnostic.
export function domainCircleMap() {
  return Object.freeze({ ...DOMAIN_CIRCLES });
}
