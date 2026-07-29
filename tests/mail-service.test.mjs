import { describe, expect, it, vi } from 'vitest';
import { createMailPolicy } from '../src/mail/mail-policy.mjs';
import { createMailService } from '../src/mail/mail-service.mjs';

function fakeAdapter(overrides = {}) {
  return {
    id: 'personal-imap',
    capabilities: Object.freeze(['createDraft', 'send', 'reply', 'forward', 'move', 'label', 'archive', 'markRead', 'markSpam', 'unsubscribe', 'trash']),
    createDraft: vi.fn(async () => ({ draftId: 'd1' })),
    send: vi.fn(async () => ({ state: 'accepted_by_provider', providerMessageId: 'm1' })),
    reply: vi.fn(async () => ({ state: 'accepted_by_provider', providerMessageId: 'm2' })),
    forward: vi.fn(async () => ({ state: 'accepted_by_provider', providerMessageId: 'm3' })),
    move: vi.fn(async () => ({ state: 'accepted_by_provider' })),
    label: vi.fn(async () => ({ state: 'accepted_by_provider' })),
    archive: vi.fn(async () => ({ state: 'accepted_by_provider' })),
    markRead: vi.fn(async () => ({ state: 'state_confirmed' })),
    markSpam: vi.fn(async () => ({ state: 'accepted_by_provider' })),
    unsubscribe: vi.fn(async () => ({ state: 'accepted_by_provider' })),
    trash: vi.fn(async () => ({ state: 'accepted_by_provider' })),
    ...overrides,
  };
}

function harness({ defaultMode = 1, rules = [], adapters, ...rest } = {}) {
  const policy = createMailPolicy({ defaultMode, rules });
  const adapter = adapters ?? fakeAdapter();
  const confirmLocal = vi.fn(async ({ action }) => ({ approved: true, token: `token-${action.digest.slice(0, 8)}`, digest: action.digest }));
  const service = createMailService({ policy, adapters: { 'personal-imap': adapter }, confirmLocal, ...rest });
  return { service, adapter, confirmLocal, policy };
}

const TARGETS = Object.freeze({ threadId: 't1', messageId: 'm0' });
const CONTENT = Object.freeze({ subject: 'Bonjour', text: 'Contenu' });

describe('mail service: proposals require a digest of account, action, targets, content, and revision', () => {
  it('produces a stable digest for identical inputs and a different one when content changes', async () => {
    const { service } = harness();
    const a = await service.propose({ accountId: 'personal-imap', action: 'reply', targets: TARGETS, content: CONTENT, revision: 'r1' });
    const b = await service.propose({ accountId: 'personal-imap', action: 'reply', targets: TARGETS, content: CONTENT, revision: 'r1' });
    const c = await service.propose({ accountId: 'personal-imap', action: 'reply', targets: TARGETS, content: { ...CONTENT, text: 'Autre' }, revision: 'r1' });
    expect(a.digest).toBe(b.digest);
    expect(a.digest).not.toBe(c.digest);
  });
});

describe('mail service: mode 1 confirmation is one-use', () => {
  it('requires confirmation, executes once with a valid token, then rejects reuse of the same token', async () => {
    const { service, adapter, confirmLocal } = harness({ defaultMode: 1 });
    const proposal = await service.propose({ accountId: 'personal-imap', action: 'reply', targets: TARGETS, content: CONTENT, revision: 'r1' });
    expect(proposal.requiresConfirmation).toBe(true);

    const first = await service.commit({ proposalId: proposal.proposalId });
    expect(confirmLocal).toHaveBeenCalledTimes(1);
    expect(adapter.reply).toHaveBeenCalledTimes(1);
    expect(first.state).toBe('accepted_by_provider');

    await expect(service.commit({ proposalId: proposal.proposalId })).rejects.toThrow('mail_proposal_already_consumed');
    expect(adapter.reply).toHaveBeenCalledTimes(1);
  });
});

describe('mail service: mode 2 checks the exact authorized rule', () => {
  it('executes without confirmation when the request carries rule authorization', async () => {
    const { service, adapter, confirmLocal } = harness({
      defaultMode: 2, rules: [{ scope: 'account', match: 'personal-imap', mode: 2 }],
    });
    const proposal = await service.propose({
      accountId: 'personal-imap', action: 'archive', targets: TARGETS, content: {}, revision: 'r1', ruleAuthorized: true,
    });
    expect(proposal.requiresConfirmation).toBe(false);
    await service.commit({ proposalId: proposal.proposalId });
    expect(confirmLocal).not.toHaveBeenCalled();
    expect(adapter.archive).toHaveBeenCalledTimes(1);
  });

  it('still requires confirmation when mode 2 has no matching rule authorization', async () => {
    const { service } = harness({ defaultMode: 2 });
    const proposal = await service.propose({ accountId: 'personal-imap', action: 'archive', targets: TARGETS, content: {}, revision: 'r1' });
    expect(proposal.requiresConfirmation).toBe(true);
  });
});

describe('mail service: mode 3 still enforces absolute denials', () => {
  it('refuses a permanent purge even in full-automation mode 3', async () => {
    const { service } = harness({ defaultMode: 3 });
    await expect(service.propose({ accountId: 'personal-imap', action: 'purge', targets: TARGETS, content: {}, revision: 'r1' }))
      .rejects.toThrow('mail_action_forbidden');
  });
});

describe('mail service: every action type routes to its adapter method', () => {
  it.each([
    ['label', 'label'], ['move', 'move'], ['archive', 'archive'], ['mark_read', 'markRead'], ['mark_spam', 'markSpam'],
    ['unsubscribe', 'unsubscribe'], ['trash', 'trash'], ['forward', 'forward'],
  ])('commits a %s proposal through the matching adapter method', async (action, methodName) => {
    const { service, adapter } = harness({ defaultMode: 3, rules: [{ scope: 'account', match: 'personal-imap', mode: 3 }] });
    const proposal = await service.propose({ accountId: 'personal-imap', action, targets: TARGETS, content: CONTENT, revision: 'r1' });
    await service.commit({ proposalId: proposal.proposalId });
    expect(adapter[methodName]).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error instead of silently no-oping when the adapter does not support an action', async () => {
    const { service } = harness({ defaultMode: 3, adapters: fakeAdapter({ unsubscribe: undefined }) });
    const proposal = await service.propose({ accountId: 'personal-imap', action: 'unsubscribe', targets: TARGETS, content: {}, revision: 'r1' });
    await expect(service.commit({ proposalId: proposal.proposalId })).rejects.toThrow('mail_action_unsupported_by_provider:unsubscribe');
  });

  it('rejects an undeclared provider action while proposing, before a confirmation or a provider call', async () => {
    const adapter = fakeAdapter({ capabilities: Object.freeze(['createDraft', 'send']) });
    const { service, confirmLocal } = harness({ defaultMode: 3, adapters: adapter });

    await expect(service.propose({ accountId: 'personal-imap', action: 'unsubscribe', targets: TARGETS, content: {}, revision: 'r1' }))
      .rejects.toThrow('mail_action_unsupported_by_provider:unsubscribe');
    expect(confirmLocal).not.toHaveBeenCalled();
    expect(adapter.unsubscribe).not.toHaveBeenCalled();
  });
});

describe('mail service: duplicate retry is idempotent, never double-sends', () => {
  it('returns the same recorded result when the exact same proposal is retried after commit', async () => {
    const { service, adapter } = harness({ defaultMode: 3, rules: [{ scope: 'account', match: 'personal-imap', mode: 3 }] });
    const proposal = await service.propose({ accountId: 'personal-imap', action: 'send', targets: TARGETS, content: CONTENT, revision: 'r1' });
    const first = await service.commit({ proposalId: proposal.proposalId });
    const second = await service.commit({ proposalId: proposal.proposalId });
    expect(second).toEqual(first);
    expect(adapter.send).toHaveBeenCalledTimes(1);
  });
});

describe('mail service: per-minute and per-thread budgets pause automation on a loop', () => {
  it('pauses the account automation after exceeding the per-minute send budget', async () => {
    let now = 1_752_000_000_000;
    const { service, adapter } = harness({
      defaultMode: 3, rules: [{ scope: 'account', match: 'personal-imap', mode: 3 }],
      budgets: { maxSendsPerMinute: 2 }, now: () => now,
    });
    for (let index = 0; index < 2; index += 1) {
      const proposal = await service.propose({ accountId: 'personal-imap', action: 'send', targets: { ...TARGETS, messageId: `m${index}` }, content: CONTENT, revision: `r${index}` });
      await service.commit({ proposalId: proposal.proposalId });
    }
    const proposal = await service.propose({ accountId: 'personal-imap', action: 'send', targets: { ...TARGETS, messageId: 'm3' }, content: CONTENT, revision: 'r3' });
    await expect(service.commit({ proposalId: proposal.proposalId })).rejects.toThrow('mail_automation_paused:per_minute_budget');
    expect(adapter.send).toHaveBeenCalledTimes(2);
    expect(service.isPaused('personal-imap')).toBe(true);
  });
});
