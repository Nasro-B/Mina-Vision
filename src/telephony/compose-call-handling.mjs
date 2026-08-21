// Orchestration de la PRISE d'appel entrant (SPEC-MINA-COMMS-001 §7, §8, §11, §17). Enchaîne les gates
// dans l'ORDRE de sûreté et n'AGIT jamais tant qu'un seul échoue : éligibilité (politique §7/§9/§11) →
// validation juridique RGPD (§17, canGoLive) → média HFP verrouillé (§6, jamais un appel muet) → session
// d'appel ouverte + journalisée. Retourne une DÉCISION ({action:'observe'|'answer'}) ; il ne décroche
// pas lui-même et n'expose aucun outil PC. Par défaut tout est en observation (RGPD non validé + média
// stub) : Mina ne répond JAMAIS avant que TOUS les gates passent. Module PUR/injectable, non câblé.

export function createCallHandler({ incomingPolicy, disclosure, hfpAdapter, ledger, createSession } = {}) {
  if (typeof incomingPolicy?.evaluateIncomingCall !== 'function' || typeof disclosure?.canGoLive !== 'function'
    || typeof hfpAdapter?.lockForCall !== 'function' || typeof ledger?.openCallSession !== 'function'
    || typeof createSession !== 'function') {
    throw new TypeError('call_handler_dependencies_required');
  }

  return Object.freeze({
    handleIncoming({ callEvent, readiness, level = 'observe', activeMinaCalls = 0, knownContacts = [], businessHours = null } = {}) {
      // 1) Éligibilité (§7/§9/§11). Observation ou refus → on n'agit pas, l'appel suit le tél natif.
      const decision = incomingPolicy.evaluateIncomingCall({
        readiness, numberE164: callEvent?.numberE164 ?? null, atMs: callEvent?.atMs ?? 0,
        activeMinaCalls, level, knownContacts, businessHours,
      });
      if (!decision.eligible) return Object.freeze({ action: 'observe', reason: decision.reason });

      // 2) Gate RGPD §17 : pas de décrochage live sans texte validé juridiquement.
      if (!disclosure.canGoLive()) return Object.freeze({ action: 'observe', reason: 'rgpd_not_validated' });

      // 3) Média HFP §6 : verrou d'endpoint AVANT le décrochage. Échec → observation (jamais un appel muet).
      let media;
      try {
        media = hfpAdapter.lockForCall({ callId: callEvent.callId, deviceId: callEvent.deviceId });
      } catch (error) {
        return Object.freeze({ action: 'observe', reason: `media_unavailable:${String(error?.message ?? error)}` });
      }

      // 4) Session ouverte + journalisée (aucun audio conservé). La machine d'état borne la suite.
      const session = createSession({ callId: callEvent.callId, deviceId: callEvent.deviceId });
      ledger.openCallSession({ callId: callEvent.callId, deviceId: callEvent.deviceId, dedupeKey: callEvent.dedupeKey ?? null });
      ledger.updateCallSession(callEvent.callId, { state: 'answering', media: media.endpointId });

      return Object.freeze({
        action: 'answer',
        callId: callEvent.callId,
        disclosureText: disclosure.disclosureText(), // §8.3, garanti validé ici (gate 2 passé)
        media,
        session,
      });
    },
  });
}
