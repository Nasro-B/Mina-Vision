import { gateResponse } from '../grounding/response-gate.mjs';
import { classifyChannelCapability } from '../safety/channel-policy.mjs';

const TRANSPORT_BY_DECISION = Object.freeze({ allow: 'sent', confirm: 'draft', deny: 'denied' });

export function createConversationService({ memoryService, router, auditLog = null, telegramCapabilities = [], clock, smsSendPolicy = null } = {}) {
  if (!memoryService?.remember || !memoryService?.recall) throw new TypeError('conversation_service_memory_required');
  if (!router?.route) throw new TypeError('conversation_service_router_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('conversation_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const audit = (entry) => auditLog?.record?.({ ...entry, at: new Date(now()).toISOString() });

  return Object.freeze({
    // Records an incoming turn as a memory event under the channel's own identity kind (phone for
    // SMS, telegram for Telegram) — cross-channel recall then works purely through identityGraph
    // linking already built in memoryService/identityGraph, nothing new to duplicate here.
    async ingest(raw) {
      const { turn, policy } = router.route(raw);
      if (policy.decision === 'deny') {
        await audit({ type: 'conversation_turn_denied', channel: turn.channel, reason: policy.reason });
        throw new Error('conversation_turn_denied');
      }
      const event = memoryService.remember({
        channel: turn.channel, kind: turn.identity.kind, value: turn.identity.value,
        content: turn.text, classification: raw.classification ?? 'normal', provenance: { source: turn.channel },
      });
      await audit({ type: 'conversation_turn_ingested', channel: turn.channel, eventId: event.id });
      return Object.freeze({ event, turn, policy });
    },

    recallFor({ kind, value, query, revealSensitive = false } = {}) {
      return memoryService.recall({ kind, value, query, revealSensitive });
    },

    // Every outgoing turn crosses the response gate first (never transported un-gated), then the
    // same channel/capability policy used for incoming turns decides the transport: 'allow' sends
    // automatically, 'confirm' stays a draft pending local/owner confirmation, 'deny' blocks outright.
    async respond({
      channel, capability, draft, claims, citations, recipient,
      isNewRecipient, isGroup, hasAttachment, hasSecondaryAction, ownerRecognized,
    }) {
      const gated = gateResponse({ draft, claims, citations });
      if (gated.decision !== 'allow') {
        await audit({ type: 'conversation_response_blocked', channel, decision: gated.decision });
        return Object.freeze(gated.decision === 'block'
          ? { transport: 'blocked', decision: gated.decision, safeResponse: gated.safeResponse }
          : { transport: 'blocked', decision: gated.decision, issues: gated.issues });
      }

      const policy = capability
        ? classifyChannelCapability({ channel, capability }, { telegramCapabilities })
        : Object.freeze({ decision: 'allow', reason: 'no_capability_requested' });
      let transport = TRANSPORT_BY_DECISION[policy.decision];
      let policyReason;
      // SMS only: a channel-policy 'draft' can still be escalated to an automatic send when a
      // send policy explicitly allows it (allowlisted recipient, quiet hours, budget…) — never
      // the reverse, and never for any other channel (Telegram keeps its own capability rules).
      if (channel === 'sms' && transport === 'draft' && smsSendPolicy) {
        const smsDecision = smsSendPolicy.decide({
          recipient, content: gated.response?.text, isNewRecipient, isGroup, hasAttachment, hasSecondaryAction, ownerRecognized,
        });
        if (smsDecision.decision === 'auto') transport = 'sent';
        else policyReason = smsDecision.reason;
      }
      await audit({ type: 'conversation_response_ready', channel, transport });
      return Object.freeze({ transport, response: gated.response, ...(policyReason ? { policyReason } : {}) });
    },
  });
}
