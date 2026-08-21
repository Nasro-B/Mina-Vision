// Cycle de vie T3.4 (SPEC agente-codage V3, décision T0.2 = périmètre déploiement) : Mina PRÉPARE un
// déploiement mais ne l'EXÉCUTE JAMAIS elle-même (aligné sur la clause « auto-évolution gouvernée » de
// MINA.md et la règle maison « push/deploy manuels »). Elle exige un build VERT d'abord, produit la
// commande CLI EXACTE, liste les variables d'env manquantes (NOMS seulement, jamais de valeur/token), puis
// PRÉSENTE et attend le feu vert de Nasro. Refus net si build rouge ou cible inconnue. Aucun secret n'entre
// jamais dans la sortie ni le journal. Module PUR.

export const DEPLOY_TARGETS = Object.freeze({
  vercel: Object.freeze({ command: 'vercel deploy --prod', label: 'Vercel' }),
  render: Object.freeze({ command: 'render deploys create', label: 'Render' }),
  cloudflare: Object.freeze({ command: 'wrangler deploy', label: 'Cloudflare Workers' }),
});

export function createDeployPolicy({ targets = DEPLOY_TARGETS } = {}) {
  return Object.freeze({
    prepare({ target, buildStatus, requiredEnv = [], presentEnv = [] } = {}) {
      const spec = targets[target];
      if (!spec) {
        return Object.freeze({ ready: false, refused: true, reason: 'cible_inconnue', target: target ?? null });
      }
      // Jamais de déploiement sur un build rouge (ou non prouvé vert).
      if (buildStatus !== 'green') {
        return Object.freeze({ ready: false, refused: true, reason: 'build_non_vert', target });
      }
      const missingEnv = Object.freeze((requiredEnv ?? []).filter((name) => !(presentEnv ?? []).includes(name)));
      return Object.freeze({
        ready: missingEnv.length === 0,
        refused: false,
        target,
        label: spec.label,
        command: spec.command, // commande EXACTE — aucun token, aucune valeur secrète
        missingEnv, // NOMS de variables manquantes, jamais leur valeur
        awaitingApproval: true, // Mina n'exécute JAMAIS : c'est le feu vert de Nasro qui déploie
        note: `Déploiement ${spec.label} PRÉPARÉ. ${missingEnv.length ? `Variables manquantes à poser : ${missingEnv.join(', ')}. ` : ''}Exécution = ton feu vert (jamais automatique).`,
      });
    },
  });
}
