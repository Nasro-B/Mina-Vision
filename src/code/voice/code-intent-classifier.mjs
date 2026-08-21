// Voix T6.1 (SPEC agente-codage V6) : couche DÉTERMINISTE qui reconnaît les commandes vocales de code
// (creer/analyser/valider/deployer un projet, ameliorer_toi, lister/restaurer une version) AVANT le modèle
// vocal — comme la couche capacités de mina-dialogue. Leçon du bug « que sais-tu faire » : les DEUX
// couches (déterministe + modèle) doivent couvrir les formulations naturelles ; sur-déclencher est bénin,
// mais un faux positif sur une phrase quelconque ne l'est pas → patterns resserrés, prouvés par test.
// Module PUR. (Les déclarations LIVE_TOOLS + handlers sont câblés côté voix — ce module ne fait que classer.)

function normalize(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/gu, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/['’-]/gu, ' ')
    .replace(/[^a-z0-9 ]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

// Ordre : les intents SPÉCIFIQUES (ameliorer_toi, versions) avant les génériques (creer/valider), pour
// qu'« améliore-toi » ne matche pas « créer ».
const CODE_INTENTS = [
  { intent: 'ameliorer_toi', re: /\b(ameliore toi|ameliore ton|modifie toi|ajoute toi|change ton code|ameliore ta|corrige toi)\b/u },
  { intent: 'restaurer_version', re: /\b(restaure|rollback|reviens a la version|version d avant|version d hier|reviens en arriere de version|reviens a hier)\b/u },
  { intent: 'lister_versions', re: /\b(liste tes versions|tes checkpoints|historique des versions|quelles versions|tes versions)\b/u },
  { intent: 'deployer_projet', re: /\b(deploie|deployer|mets en ligne|mise en ligne|publie le projet|deploie le projet)\b/u },
  { intent: 'valider_projet', re: /\b(valide le projet|valider le projet|lance les tests|teste le projet|verifie le projet)\b/u },
  { intent: 'analyser_projet', re: /\b(analyse le projet|analyser le projet|examine le projet|c est quoi ce projet|comprends ce projet|cartographie le projet)\b/u },
  { intent: 'creer_projet', re: /\b(cree|creer|construis|construire|genere|nouveau projet|fais moi)\b.*\b(projet|api|application|app|site|cli|outil|serveur)\b/u },
];

export function classifyCodeCommand(utterance) {
  const n = normalize(utterance);
  if (!n) return null;
  for (const { intent, re } of CODE_INTENTS) {
    if (re.test(n)) return Object.freeze({ intent });
  }
  return null; // pas une commande de code déterministe
}

export function codeIntents() {
  return Object.freeze(CODE_INTENTS.map((c) => c.intent));
}
