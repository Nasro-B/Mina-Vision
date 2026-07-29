import { randomUUID, createHash } from 'node:crypto';
import { canonicalJson } from '../memory/record-codec.mjs';
import { createMailVerifier } from './mail-verifier.mjs';

const ACCOUNT_ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const ACTION_METHODS = Object.freeze({
  create_draft: 'createDraft', send: 'send', reply: 'reply', forward: 'forward',
  move: 'move', label: 'label', archive: 'archive', mark_read: 'markRead', mark_spam: 'markSpam',
  unsubscribe: 'unsubscribe', trash: 'trash',
});
const SENDING_ACTIONS = new Set(['send', 'reply', 'forward']);
const WINDOW_MS = { perMinute: 60_000, perHour: 60 * 60_000 };

function digestFor({ accountId, action, targets, content, revision }) {
  return createHash('sha256').update(canonicalJson({ accountId, action, targets, content, revision })).digest('hex');
}

export function createMailService({
  policy,
  adapters,
  confirmLocal,
  budgets = {},
  now = Date.now,
} = {}) {
  if (!policy?.decide || !adapters || typeof adapters !== 'object' || typeof confirmLocal !== 'function') {
    throw new TypeError('mail_service_dependencies_required');
  }
  const verifier = createMailVerifier();
  const proposals = new Map();
  const pausedAccounts = new Set();
  const sendTimestamps = new Map();

  function adapterFor(accountId) {
    if (!ACCOUNT_ID.test(accountId ?? '')) throw new TypeError('mail_service_account_invalid');
    const adapter = adapters[accountId];
    if (!adapter) throw new Error('mail_service_adapter_missing');
    return adapter;
  }

  async function propose({ accountId, action, targets, content, revision, ruleAuthorized, confirmedLocally, threadId } = {}) {
    const adapter = adapterFor(accountId);
    const decision = policy.decide({
      action, requestedBy: 'automation', accountId, threadId: threadId ?? targets?.threadId, ruleAuthorized, confirmedLocally,
    });
    if (decision.decision === 'deny') throw new Error(decision.reason);
    if (!Object.hasOwn(ACTION_METHODS, action ?? '')) throw new TypeError('mail_proposal_action_invalid');
    const method = ACTION_METHODS[action];
    if (!Array.isArray(adapter.capabilities) || !adapter.capabilities.includes(method)) {
      throw new Error(`mail_action_unsupported_by_provider:${action}`);
    }

    const digest = digestFor({ accountId, action, targets, content, revision });
    const proposalId = randomUUID();
    proposals.set(proposalId, Object.freeze({
      proposalId, accountId, action, targets: targets ?? {}, content: content ?? {}, revision, digest,
      requiresConfirmation: decision.decision === 'confirm', consumed: false, result: null,
    }));
    return Object.freeze({ proposalId, digest, requiresConfirmation: decision.decision === 'confirm' });
  }

  function recentSendCount(accountId, windowMs) {
    const timestamps = sendTimestamps.get(accountId) ?? [];
    return timestamps.filter((timestamp) => now() - timestamp < windowMs).length;
  }

  async function commit({ proposalId } = {}) {
    const proposal = proposals.get(proposalId);
    if (!proposal) throw new Error('mail_proposal_not_found');
    if (proposal.consumed) {
      if (proposal.requiresConfirmation) throw new Error('mail_proposal_already_consumed');
      return proposal.result;
    }

    if (proposal.requiresConfirmation) {
      const confirmation = await confirmLocal({
        reason: `Confirmer l'action e-mail « ${proposal.action} ».`,
        action: { name: `mail.${proposal.action}`, digest: proposal.digest, accountId: proposal.accountId, targets: proposal.targets },
      });
      if (!confirmation?.approved || confirmation.digest !== proposal.digest || typeof confirmation.token !== 'string' || !confirmation.token) {
        throw new Error('mail_confirmation_refused');
      }
    }

    if (SENDING_ACTIONS.has(proposal.action)) {
      if (pausedAccounts.has(proposal.accountId)) throw new Error('mail_automation_paused:per_minute_budget');
      if (budgets.maxSendsPerMinute != null && recentSendCount(proposal.accountId, WINDOW_MS.perMinute) >= budgets.maxSendsPerMinute) {
        pausedAccounts.add(proposal.accountId);
        throw new Error('mail_automation_paused:per_minute_budget');
      }
      if (budgets.maxSendsPerHour != null && recentSendCount(proposal.accountId, WINDOW_MS.perHour) >= budgets.maxSendsPerHour) {
        pausedAccounts.add(proposal.accountId);
        throw new Error('mail_automation_paused:per_hour_budget');
      }
    }

    const adapter = adapterFor(proposal.accountId);
    const method = ACTION_METHODS[proposal.action];
    const invoke = adapter[method];
    if (!Array.isArray(adapter.capabilities) || !adapter.capabilities.includes(method) || typeof invoke !== 'function') {
      throw new Error(`mail_action_unsupported_by_provider:${proposal.action}`);
    }

    const rawResult = await invoke.call(adapter, { ...proposal.targets, ...proposal.content });
    const verified = await verifier.verify({ providerResult: rawResult });

    if (SENDING_ACTIONS.has(proposal.action)) {
      sendTimestamps.set(proposal.accountId, [...(sendTimestamps.get(proposal.accountId) ?? []), now()]);
    }

    proposals.set(proposalId, Object.freeze({ ...proposal, consumed: true, result: verified }));
    return verified;
  }

  function isPaused(accountId) {
    return pausedAccounts.has(accountId);
  }

  function resumeAutomation(accountId) {
    pausedAccounts.delete(accountId);
  }

  return Object.freeze({ propose, commit, isPaused, resumeAutomation });
}
