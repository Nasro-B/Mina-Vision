const CALLBACK_PATTERN = /^(approve|deny|proofs):([0-9a-f-]{36}):([a-f0-9]{64})$/u;

function buildSummary(approval) {
  return [
    `Action : ${approval.capability}`,
    `Ressource : ${approval.resourceDigest}`,
    `État actuel : ${approval.observedStateDigest}`,
    `Effet attendu : ${JSON.stringify(approval.expectedEffect)}`,
    `Détails : ${JSON.stringify(approval.disclosedData)}`,
    `Expire : ${approval.expiresAt}`,
  ].join('\n');
}

function bareDigest(prefixedDigest) {
  return prefixedDigest.startsWith('sha256:') ? prefixedDigest.slice('sha256:'.length) : prefixedDigest;
}

export function createTelegramApprovalAdapter({ approvalService, isOwner, transport, audit } = {}) {
  if (!approvalService?.approve || !approvalService?.deny || !approvalService?.get) {
    throw new TypeError('telegram_approval_adapter_service_required');
  }
  if (typeof isOwner !== 'function') throw new TypeError('telegram_approval_adapter_owner_check_required');
  if (!transport?.sendMessage) throw new TypeError('telegram_approval_adapter_transport_required');
  if (!audit?.record) throw new TypeError('telegram_approval_adapter_audit_required');

  return Object.freeze({
    async sendRequest(approval) {
      const digest = bareDigest(approval.digest);
      const buttons = ['approve', 'deny', 'proofs'].map((action) => ({
        text: action === 'approve' ? 'Approuver' : action === 'deny' ? 'Refuser' : 'Preuves',
        callbackData: `${action}:${approval.approvalId}:${digest}`,
      }));
      return transport.sendMessage({ text: buildSummary(approval), buttons });
    },

    async handleCallback(callback) {
      const match = CALLBACK_PATTERN.exec(String(callback?.data ?? ''));
      if (!match) {
        audit.record({ type: 'remote_approval_malformed_callback', sender: callback?.from?.id ?? null });
        return Object.freeze({ reply: 'Requête invalide.' });
      }
      const [, action, approvalId, digestHex] = match;
      const senderId = callback?.from?.id;

      if (!(await isOwner(senderId))) {
        audit.record({ type: 'remote_approval_denied_identity', sender: senderId, approvalId, action });
        return Object.freeze({ reply: 'Commande refusée.' });
      }

      const callbackDigest = `sha256:${digestHex}`;

      if (action === 'proofs') {
        const approval = await approvalService.get(approvalId);
        audit.record({ type: 'remote_approval_proofs_viewed', sender: senderId, approvalId });
        return Object.freeze({ reply: buildSummary(approval) });
      }

      try {
        const result = action === 'approve'
          ? await approvalService.approve({ approvalId, ownerTelegramId: senderId, callbackDigest })
          : await approvalService.deny({ approvalId, ownerTelegramId: senderId, callbackDigest });
        audit.record({ type: `remote_approval_${action}d`, sender: senderId, approvalId });
        return Object.freeze({ reply: action === 'approve' ? 'Approuvé.' : 'Refusé.', approval: result });
      } catch (error) {
        audit.record({ type: 'remote_approval_callback_failed', sender: senderId, approvalId, reason: error.message });
        return Object.freeze({ reply: `Impossible : ${error.message}` });
      }
    },
  });
}
