// Analyseur d'erreurs de Mina : traduit chaque code d'erreur technique RÉEL du système en
// explication française + remède actionnable + gravité. Branché sur l'outil vocal
// lire_erreurs_techniques : Mina n'énonce plus des codes bruts, elle explique et propose.
// Un motif inconnu reste honnête : « erreur non répertoriée », jamais une invention.

const RULES = Object.freeze([
  {
    pattern: /memory_locked/u,
    gravite: 'bloquant',
    explication: 'La mémoire chiffrée est verrouillée — la mission a besoin du coffre.',
    remede: 'Déverrouiller la mémoire (phrase de récupération si le déverrouillage simple échoue), ou décocher « Exiger la mémoire » pour cette mission.',
  },
  {
    pattern: /keyring_wrapped_key_undecryptable|safeStorage\.decryptString/u,
    gravite: 'bloquant',
    explication: 'Le chiffrement Windows a changé : le déverrouillage automatique du coffre est cassé.',
    remede: 'Déverrouiller UNE fois avec la phrase de récupération — la réparation est ensuite automatique.',
  },
  {
    pattern: /keyring_already_initialized/u,
    gravite: 'info',
    explication: 'Un coffre existe déjà — impossible d\'en initialiser un second par-dessus.',
    remede: 'Utiliser « Déverrouiller » (avec phrase si besoin), pas « Initialiser ».',
  },
  {
    pattern: /sandbox_unavailable|windows_sandbox_feature_disabled|sandbox_runtimes_unavailable/u,
    gravite: 'dégradé',
    explication: 'Le bac à sable Windows n\'est pas prêt (fonctionnalité désactivée ou runtimes absents).',
    remede: 'Activer Windows Sandbox dans les fonctionnalités Windows, ou installer les runtimes (npm run models:install).',
  },
  {
    pattern: /git_not_a_repository/u,
    gravite: 'info',
    explication: 'Le dossier analysé n\'est pas un dépôt git.',
    remede: 'Initialiser git dans le projet (git init) si le suivi de version est voulu.',
  },
  {
    pattern: /web_answer_http_429|http_429|rate.?limit/iu,
    gravite: 'transitoire',
    explication: 'Le fournisseur a renvoyé « trop de requêtes » (quota atteint).',
    remede: 'Réessayer dans quelques minutes ; si fréquent, changer de fournisseur ou passer en mode économe.',
  },
  {
    pattern: /Connection error|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/iu,
    gravite: 'transitoire',
    explication: 'Coupure réseau ou fournisseur injoignable pendant l\'appel.',
    remede: 'Vérifier la connexion internet puis relancer la mission — le repli local reste disponible.',
  },
  {
    pattern: /Session Gemini Live non connectée|session_end/u,
    gravite: 'transitoire',
    explication: 'La session vocale distante est tombée en cours de route.',
    remede: 'La reprise est automatique désormais ; si la voix reste muette, couper puis relancer l\'écoute.',
  },
  {
    pattern: /adb_mdns_peer_not_discovered|adb/u,
    gravite: 'dégradé',
    explication: 'Le téléphone Android n\'est pas joignable en ADB Wi-Fi.',
    remede: 'Vérifier que le téléphone est sur le même réseau et que le débogage sans fil est actif.',
  },
  {
    pattern: /page\.screenshot|Target page, context or browser has been closed/u,
    gravite: 'transitoire',
    explication: 'Le navigateur de mission s\'est fermé pendant la capture d\'écran.',
    remede: 'Relancer la mission — elle rouvrira une page propre.',
  },
  {
    pattern: /memory_locked|coffre/u,
    gravite: 'bloquant',
    explication: 'Action refusée car le coffre mémoire est fermé.',
    remede: 'Déverrouiller la mémoire puis relancer.',
  },
  {
    pattern: /code_confirmation_denied|git_confirmation_required/u,
    gravite: 'info',
    explication: 'Action stoppée en attente d\'une confirmation explicite — comportement voulu.',
    remede: 'Confirmer l\'action si elle est souhaitée, sinon rien à faire.',
  },
  {
    pattern: /domain_degraded/u,
    gravite: 'dégradé',
    explication: 'Un domaine (mail, agenda…) démarre en mode dégradé : ses secrets ne se déchiffrent plus.',
    remede: 'Re-saisir les identifiants du service concerné dans les réglages.',
  },
]);

export function analyzeError(message) {
  const text = String(message ?? '');
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return Object.freeze({
        connue: true,
        gravite: rule.gravite,
        explication: rule.explication,
        remede: rule.remede,
      });
    }
  }
  return Object.freeze({
    connue: false,
    gravite: 'inconnue',
    explication: 'Erreur non répertoriée dans l\'analyseur.',
    remede: 'Lire le message brut et le journal technique ; ne rien affirmer au-delà des faits.',
  });
}

export function analyzeEntries(entries = []) {
  return Object.freeze(entries.map((entry) => Object.freeze({
    ...entry,
    analyse: analyzeError(`${entry.code ?? ''} ${entry.message ?? ''}`),
  })));
}
