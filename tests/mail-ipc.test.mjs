import { describe, expect, it, vi } from 'vitest';
import { createMailController } from '../src/ui/pages/mail-controller.mjs';
import { registerMailIpc } from '../src/ui/ipc/mail-ipc.mjs';

function harness(overrides = {}) {
  const deps = {
    mailAccountStore: { listStatus: vi.fn(async () => [{ accountId: 'personal-imap', provider: 'imap-smtp', mode: 3, configured: true }]) },
    mailSyncService: { pause: vi.fn(async () => {}), resume: vi.fn(async () => {}) },
    mailService: {
      propose: vi.fn(async (request) => ({ proposalId: 'p1', digest: 'd1', requiresConfirmation: request.action === 'send' })),
      commit: vi.fn(async () => ({ state: 'accepted_by_provider', providerMessageId: 'm1' })),
    },
    searchMessages: vi.fn(async () => [{ subject: 'Facture', from: 'fournisseur@example.test' }]),
    ...overrides,
  };
  return { controller: createMailController(deps), deps };
}

describe('mail controller: bounded operations', () => {
  it('lists account status without exposing credentials', async () => {
    const { controller } = harness();
    await expect(controller.listAccounts()).resolves.toEqual([{ accountId: 'personal-imap', provider: 'imap-smtp', mode: 3, configured: true }]);
  });

  it('searches within bounds by delegating to the injected search function', async () => {
    const { controller, deps } = harness();
    await expect(controller.search('facture')).resolves.toEqual([{ subject: 'Facture', from: 'fournisseur@example.test' }]);
    expect(deps.searchMessages).toHaveBeenCalledWith('facture');
  });

  it('proposes a draft through the mail service with the create_draft action', async () => {
    const { controller, deps } = harness();
    await controller.proposeDraft({ accountId: 'personal-imap', targets: {}, content: { subject: 'Bonjour', text: 'Contenu' }, revision: 'r1' });
    expect(deps.mailService.propose).toHaveBeenCalledWith(expect.objectContaining({ action: 'create_draft' }));
  });

  it('proposes and commits a send', async () => {
    const { controller, deps } = harness();
    const proposal = await controller.proposeSend({ accountId: 'personal-imap', targets: {}, content: { subject: 'Bonjour', text: 'Contenu' }, revision: 'r1' });
    await controller.commit(proposal.proposalId);
    expect(deps.mailService.commit).toHaveBeenCalledWith({ proposalId: 'p1' });
  });
});

describe('mail IPC: named allowlist only', () => {
  it('registers exactly the expected named channels and validates payload shape', async () => {
    const handlers = new Map();
    const ipcMain = { handle: vi.fn((channel, handler) => handlers.set(channel, handler)) };
    const { controller } = harness();
    registerMailIpc({ ipcMain, controller });

    expect([...handlers.keys()]).toEqual([
      'mina:mail:list-accounts',
      'mina:mail:pause',
      'mina:mail:resume',
      'mina:mail:search',
      'mina:mail:propose-draft',
      'mina:mail:propose-send',
      'mina:mail:commit',
    ]);
    await expect(handlers.get('mina:mail:pause')({}, { accountId: 'personal-imap', extra: true }))
      .rejects.toThrow('mail_ui_request_invalid');
    await handlers.get('mina:mail:pause')({}, { accountId: 'personal-imap' });
  });
});
