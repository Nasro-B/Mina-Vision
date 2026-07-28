// Décision du gate d'éveil pour les outils vocaux (T3.1). Pur et testable, extrait de `main.mjs` :
// la liste des outils exemptés est une frontière de SÉCURITÉ (elle décide ce qui peut agir sans mot
// d'éveil), donc elle doit être vérifiable et ne pas dériver silencieusement. Le module ne connaît
// ni Gemini ni la fenêtre d'éveil ; il ne fait que classer un nom d'outil et trancher la décision.
//
// Principe FAIL-CLOSED : tout outil est traité comme une ACTION à effet réel (donc soumis à l'éveil)
// SAUF s'il figure explicitement dans la liste d'exemption — lecture pure et configuration anodine.
// Ajouter un outil sans le classer le rend gardé par défaut, ce qui est le comportement sûr.

// Outils exemptés d'éveil : lecture / diagnostic / recherche, plus deux réglages sans effet réel
// (thème, sélection d'environnement). Gelé pour que le contrat de test attrape toute modification.
const WAKE_EXEMPT_TOOLS = Object.freeze([
  'voir_camera',
  'lire_erreurs_techniques',
  'lire_journal',
  'chercher_dans_le_code',
  'statut_git_du_projet',
  'analyser_le_code',
  'revue_du_code',
  'lancer_les_tests_du_projet',
  'recherche_web',
  'chercher_contact',
  'theme',
  'selectionner_environnement',
]);

const EXEMPT = new Set(WAKE_EXEMPT_TOOLS);

// Vrai si l'outil peut s'exécuter SANS éveil (lecture ou config anodine).
export function isWakeExemptTool(toolName) {
  return typeof toolName === 'string' && EXEMPT.has(toolName);
}

// Décision finale : faut-il REFUSER cet appel d'outil faute d'éveil récent ?
// Un outil exempté n'est jamais refusé. Un outil d'action est refusé si l'éveil n'est pas actif.
export function shouldRefuseVoiceAction(toolName, wakeAllowed) {
  if (isWakeExemptTool(toolName)) return false;
  return wakeAllowed !== true;
}

export const WAKE_EXEMPT_TOOL_NAMES = WAKE_EXEMPT_TOOLS;
