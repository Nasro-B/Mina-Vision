import { createHash } from 'node:crypto';

// Observateur d'état des approbations : la dépendance `state_observer` attendue par
// approval-verifier. Une approbation n'est valable que si l'état de la ressource n'a PAS changé
// entre la demande et la consommation — c'est lui qui re-calcule le digest courant au moment de
// vérifier.
//
// Modèle : chaque ressource approuvable est ENREGISTRÉE avec un fournisseur d'état (fonction pure
// qui relit l'état réel : contenu du fichier, ligne de config, entrée du store…). Le digest de la
// ressource sert de clé. FAIL-CLOSED : une ressource sans fournisseur ne peut JAMAIS re-produire
// son digest observé — la vérification échoue avec `approval_state_changed` plutôt que de valider
// à l'aveugle une approbation dont on ne sait plus observer l'état.

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export function createStateObserver({ logger = null } = {}) {
  const providers = new Map();

  function digestOf(value) {
    const canonical = typeof value === 'string' ? value : JSON.stringify(value ?? null);
    return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
  }

  return Object.freeze({
    /** Enregistre le fournisseur d'état d'une ressource. Rend le digest observé MAINTENANT. */
    async register(resourceDigest, provider) {
      if (!DIGEST.test(resourceDigest ?? '')) throw new TypeError('state_observer_resource_digest_invalid');
      if (typeof provider !== 'function') throw new TypeError('state_observer_provider_invalid');
      providers.set(resourceDigest, provider);
      return digestOf(await provider());
    },

    unregister(resourceDigest) {
      providers.delete(resourceDigest);
    },

    /** Digest COURANT de la ressource. Sans fournisseur : sentinelle jamais égale à un vrai digest. */
    async observe(resourceDigest) {
      const provider = providers.get(resourceDigest);
      if (!provider) {
        logger?.append?.({ event: 'approbation_ressource_inconnue', resourceDigest: String(resourceDigest).slice(0, 32) });
        return 'sha256:ressource_inconnue_fail_closed';
      }
      return digestOf(await provider());
    },

    /** Utilitaire pour les appelants : digest canonique d'une valeur d'état. */
    digestOf,
  });
}
