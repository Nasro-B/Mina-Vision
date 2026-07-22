// Autorité des actions Computer Use (R-01) : AUCUNE action à effet n'atteint l'exécuteur sans
// grant de session actif ; toute action SENSIBLE exige en plus une confirmation locale liée
// cryptographiquement au digest exact de l'action, consommable une seule fois. classifyAction()
// garde son rôle d'arrêt dur (gestionnaires de mots de passe, terminaux, refus du modèle) —
// l'authorizer le rejoue AVANT même d'interroger le broker.

import { createHash } from 'node:crypto';
import { classifyAction } from './policy.mjs';

const READ_ACTIONS = new Set(['move', 'scroll', 'wait', 'observe']);
const DEFAULT_CONFIRMATION_TTL_MS = 120_000;

function canonicalArguments(action) {
  // Arguments matériels de l'action, ordonnés — le digest doit être stable et couvrir tout ce
  // qui change l'effet (coordonnées, texte, touches, URL, application).
  const keys = ['x', 'y', 'endX', 'endY', 'scrollX', 'scrollY', 'text', 'keys', 'url', 'app', 'packageName', 'activityName', 'milliseconds', 'replaceText', 'pressEnter'];
  const output = {};
  for (const key of keys) {
    if (action[key] !== undefined) output[key] = action[key];
  }
  return output;
}

function deriveResource(action, context) {
  // Jamais un texte libre du modèle : l'origine URL publique du contexte courant, sinon
  // l'application au premier plan, sinon l'environnement.
  if (typeof context?.url === 'string' && context.url) {
    try {
      return new URL(context.url).origin;
    } catch { /* URL de contexte illisible : on retombe sur l'app */ }
  }
  if (typeof context?.app === 'string' && context.app) return context.app;
  return `environment:${context?.environment ?? 'desktop'}`;
}

export function createComputerActionAuthorizer({ capabilityBroker, clock = Date.now } = {}) {
  if (typeof capabilityBroker?.authorize !== 'function' || typeof capabilityBroker?.grantConfirmation !== 'function') {
    throw new TypeError('capability_broker_required');
  }

  function buildRequest({ sessionId, channel = 'local', action, context = {}, origin = 'model' }) {
    if (!sessionId || typeof sessionId !== 'string') throw new TypeError('work_session_id_required');
    if (!action?.name) throw new TypeError('action_required');
    const safety = classifyAction(action, context);
    const resource = deriveResource(action, context);
    const digest = `sha256:${createHash('sha256').update(JSON.stringify({
      name: action.name,
      arguments: canonicalArguments(action),
      resource,
      intent: action.intent ?? '',
      expectedEffect: action.expectedEffect ?? null,
    })).digest('hex')}`;
    return Object.freeze({
      sessionId,
      channel,
      origin,
      capability: `computer.${action.name}`,
      effect: READ_ACTIONS.has(action.name) ? 'read' : 'execute',
      resource,
      digest,
      sensitivity: safety.decision === 'confirm' ? 'sensitive' : 'ordinary',
      safety: Object.freeze(safety),
    });
  }

  return Object.freeze({
    // N'exécute rien : retourne la décision et la requête canonique.
    async assess(input) {
      const request = buildRequest(input);
      if (request.safety.decision === 'block') {
        return Object.freeze({ decision: 'deny', reason: request.safety.reason, hardBlock: true, request });
      }
      const decision = await capabilityBroker.authorize(request);
      return Object.freeze({ decision: decision.decision, reason: decision.reason, request });
    },

    // Lie la confirmation locale au digest exact et la consomme immédiatement : seule la
    // réponse `confirmation_consumed` autorise l'exécution — jamais réutilisable.
    async confirm({ request, expiresAt } = {}) {
      if (!request?.digest) throw new TypeError('authorization_request_required');
      capabilityBroker.grantConfirmation({
        sessionId: request.sessionId,
        capability: request.capability,
        resource: request.resource,
        digest: request.digest,
        expiresAt: expiresAt ?? new Date(Number(clock()) + DEFAULT_CONFIRMATION_TTL_MS).toISOString(),
      });
      const decision = await capabilityBroker.authorize(request);
      return Object.freeze({ decision: decision.decision, reason: decision.reason, request });
    },
  });
}
