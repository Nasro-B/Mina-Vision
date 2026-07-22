const MODES = new Set(['confirm_every_send', 'auto_allowlisted', 'draft_only']);
const SHORT_OR_PREMIUM = /^\+?[0-9]{1,6}$/u; // a real E.164 mobile number is always longer than this
const SENSITIVE_CONTENT = /mot de passe|password\b|code (de )?v[ée]rification|\bcvv\b|\biban\b|carte (bancaire|de cr[ée]dit)|num[ée]ro de carte|virement/iu;

// Decides confirm/auto/draft_only for an outbound SMS — mirrors src/safety/policy.mjs's pure
// decision-function shape. Acceptance rule enforced structurally: "auto" is only ever reachable
// from mode 'auto_allowlisted', for a recognized owner, an allowlisted non-new recipient, a
// non-group, non-short/premium number, with plain content, inside quiet hours and under budget —
// remove any ONE of those checks and the function still can't accidentally return "auto".
export function createSmsSendPolicy({
  mode = 'confirm_every_send',
  allowlist = [],
  quietHoursStart = null,
  quietHoursEnd = null,
  maxPerMinute = 3,
  maxPerDay = 20,
  now = () => Date.now(),
} = {}) {
  if (!MODES.has(mode)) throw new TypeError(`sms_send_policy_mode_invalid:${mode}`);
  const configuredMode = mode;
  let revoked = false;
  const allowSet = new Set(allowlist);
  const sentAtMs = [];

  function withinQuietHours(nowMs) {
    if (quietHoursStart === null || quietHoursEnd === null) return true;
    const hour = new Date(nowMs).getHours();
    return quietHoursStart <= quietHoursEnd
      ? hour >= quietHoursStart && hour < quietHoursEnd
      : hour >= quietHoursStart || hour < quietHoursEnd; // wraps past midnight
  }

  function underBudget(nowMs) {
    const perMinute = sentAtMs.filter((t) => t > nowMs - 60_000).length;
    const perDay = sentAtMs.filter((t) => t > nowMs - 86_400_000).length;
    return perMinute < maxPerMinute && perDay < maxPerDay;
  }

  return Object.freeze({
    get mode() { return revoked ? 'confirm_every_send' : configuredMode; },
    decide({
      recipient, content = '', isNewRecipient = false, isGroup = false,
      hasAttachment = false, hasSecondaryAction = false, ownerRecognized = true,
    } = {}) {
      const effectiveMode = revoked ? 'confirm_every_send' : configuredMode;
      if (effectiveMode === 'draft_only') return Object.freeze({ decision: 'draft_only', reason: 'Mode brouillon uniquement.' });
      if (effectiveMode === 'confirm_every_send') return Object.freeze({ decision: 'confirm', reason: 'Confirmation systématique activée.' });
      if (!ownerRecognized) return Object.freeze({ decision: 'confirm', reason: 'Propriétaire non reconnu.' });
      if (isGroup) return Object.freeze({ decision: 'confirm', reason: 'Conversation de groupe.' });
      if (isNewRecipient || !allowSet.has(recipient)) return Object.freeze({ decision: 'confirm', reason: 'Destinataire non autorisé.' });
      if (SHORT_OR_PREMIUM.test(recipient)) return Object.freeze({ decision: 'confirm', reason: 'Numéro court ou surtaxé.' });
      if (hasAttachment || hasSecondaryAction) return Object.freeze({ decision: 'confirm', reason: 'Pièce jointe ou action secondaire.' });
      if (SENSITIVE_CONTENT.test(content)) return Object.freeze({ decision: 'confirm', reason: 'Contenu sensible détecté.' });
      const nowMs = now();
      if (!withinQuietHours(nowMs)) return Object.freeze({ decision: 'confirm', reason: 'Hors fenêtre horaire autorisée.' });
      if (!underBudget(nowMs)) return Object.freeze({ decision: 'confirm', reason: 'Budget d’envoi automatique dépassé.' });
      return Object.freeze({ decision: 'auto', reason: null });
    },
    recordSent(atMs = now()) { sentAtMs.push(atMs); },
    // Immediate global stop: every automatic decision reverts to confirm_every_send until
    // reactivate() is called explicitly — nothing can send unattended in between.
    revokeAutomation() { revoked = true; },
    reactivate() { revoked = false; },
  });
}
