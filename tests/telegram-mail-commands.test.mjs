import { describe, expect, it, vi } from 'vitest';
import { createTelegramMailCommands } from '../src/messaging/telegram-mail-commands.mjs';
import { createMailPolicy } from '../src/mail/mail-policy.mjs';

function harness(overrides = {}) {
  const policy = createMailPolicy({ defaultMode: 3 });
  const deps = {
    isOwner: vi.fn(async (sender) => sender === '999111222'),
    mailAccountStore: { listStatus: vi.fn(async () => [{ accountId: 'personal-imap', provider: 'imap-smtp', mode: 3, configured: true }]) },
    mailSyncService: { pause: vi.fn(async () => {}), resume: vi.fn(async () => {}) },
    mailPolicies: { 'personal-imap': policy },
    audit: vi.fn(),
    notifyPc: vi.fn(async () => {}),
    searchMessages: vi.fn(async () => [{ subject: 'Facture', from: 'fournisseur@example.test' }]),
    ...overrides,
  };
  return { commands: createTelegramMailCommands(deps), deps, policy };
}

describe('Telegram /mail commands: owner identity is the only gate', () => {
  it('refuses a non-owner sender without revealing account details, and audits the denial', async () => {
    const { commands, deps } = harness();
    const result = await commands.handle({ sender: 'stranger-42', body: '/mail status' });
    expect(result.reply.join('')).not.toContain('personal-imap');
    expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({ type: 'telegram_mail_command_denied_identity' }));
  });

  it('ignores non-/mail text entirely instead of treating it as a command', async () => {
    const { commands } = harness();
    await expect(commands.handle({ sender: '999111222', body: 'juste un message normal' })).resolves.toBeNull();
  });
});

describe('Telegram /mail commands: status, pause, resume', () => {
  it('reports account status to the owner', async () => {
    const { commands } = harness();
    const result = await commands.handle({ sender: '999111222', body: '/mail status' });
    expect(result.reply.join('')).toContain('personal-imap');
  });

  it('pauses every configured account and audits the action', async () => {
    const { commands, deps } = harness();
    await commands.handle({ sender: '999111222', body: '/mail pause' });
    expect(deps.mailSyncService.pause).toHaveBeenCalledWith('personal-imap');
    expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({ type: 'telegram_mail_pause' }));
  });

  it('resumes every configured account', async () => {
    const { commands, deps } = harness();
    await commands.handle({ sender: '999111222', body: '/mail resume' });
    expect(deps.mailSyncService.resume).toHaveBeenCalledWith('personal-imap');
  });
});

describe('Telegram /mail commands: mode change audits and notifies the PC', () => {
  it('changes the live policy mode, records an audit event, and notifies the PC without a second confirmation', async () => {
    const { commands, deps, policy } = harness();
    const result = await commands.handle({ sender: '999111222', body: '/mail mode 1' });
    expect(policy.mode()).toBe(1);
    expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({ type: 'telegram_mail_mode_changed', mode: 1 }));
    expect(deps.notifyPc).toHaveBeenCalledWith(expect.objectContaining({ type: 'mail_mode_changed', mode: 1 }));
    expect(result.reply.join('')).toContain('1');
  });

  it('rejects an out-of-range mode value instead of silently ignoring it', async () => {
    const { commands } = harness();
    const result = await commands.handle({ sender: '999111222', body: '/mail mode 9' });
    expect(result.reply.join('')).toContain('inconnue');
  });
});

describe('Telegram /mail commands: bounded, segmented full-body search results', () => {
  it('splits a long reply into segments no larger than the bounded chunk size', async () => {
    const longSubject = 'A'.repeat(9000);
    const { commands } = harness({ searchMessages: vi.fn(async () => [{ subject: longSubject, from: 'x@example.test' }]) });
    const result = await commands.handle({ sender: '999111222', body: '/mail search facture' });
    expect(result.reply.length).toBeGreaterThan(1);
    expect(result.reply.every((segment) => segment.length <= 3500)).toBe(true);
  });
});
