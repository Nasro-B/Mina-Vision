// Génère une réponse SMS à un message entrant actionnable (SPEC-MINA-STANDARDISTE-001 §7 C2).
// C'est le « flux de génération » que main.mjs:344 signalait absent : la plomberie d'ENVOI (routeur,
// outbox, politique) existait, mais rien ne produisait le texte de réponse.
//
// PUR / injectable : `draftReply` (le LLM) est INJECTÉ → testable sans modèle. Le corps du SMS entrant
// est passé comme CHAMP de contexte (`message`), jamais concaténé dans une instruction : un SMS entrant
// est une DONNÉE, il ne peut pas ordonner une action à Mina (anti-injection §4.3). Ce sont la persona et
// les consignes du jour (propriétaire) qui pilotent le ton et le fond. La politique d'envoi
// (`sms-send-policy`) décide ensuite : `auto` (part seule), `confirm` (attend le OK propriétaire) ou
// `draft_only` (reste un brouillon). Ce module NE FAIT PAS l'envoi ; il produit une INTENTION que
// l'appelant route via `communications-domain.routeOutbound` + l'outbox durable, selon la décision.

export function createSmsReplyGenerator({ draftReply, policy, persona = '', maxLength = 480 } = {}) {
  if (typeof draftReply !== 'function' || typeof policy?.decide !== 'function') {
    throw new TypeError('sms_reply_generator_dependencies_required');
  }

  return Object.freeze({
    async propose({ inbound, dailyInstructions = '', ownerRecognized = true } = {}) {
      if (!inbound || typeof inbound.senderE164 !== 'string' || !inbound.senderE164
        || typeof inbound.body !== 'string' || !inbound.body) {
        throw new TypeError('sms_reply_inbound_invalid');
      }
      // Le LLM reçoit le message entrant comme donnée encadrée, jamais comme consigne exécutable.
      const raw = await draftReply({
        persona,
        dailyInstructions: String(dailyInstructions ?? ''),
        from: inbound.senderE164,
        message: inbound.body,
      });
      const reply = String(raw ?? '').trim().slice(0, maxLength);
      if (!reply) {
        return Object.freeze({ decision: 'skip', reason: 'aucun_brouillon', reply: '', recipient: inbound.senderE164, deviceId: inbound.deviceId ?? null });
      }
      const verdict = policy.decide({ recipient: inbound.senderE164, content: reply, ownerRecognized });
      return Object.freeze({
        decision: verdict.decision, // 'auto' | 'confirm' | 'draft_only'
        reason: verdict.reason,
        reply,
        recipient: inbound.senderE164,
        deviceId: inbound.deviceId ?? null,
      });
    },
  });
}
