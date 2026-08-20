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
    attachmentRepository: { getAttachmentBytes: vi.fn(async () => Buffer.from('PDF bytes')) },
    confirmLocal: vi.fn(async () => true),
    selectAttachmentExportPath: vi.fn(async () => 'C:\\Exports\\mail-attachment.bin'),
    writer: { writeAtomic: vi.fn(async ({ content }) => ({ bytes: content.length })) },
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

  it('exports one attachment by digest only after local confirmation and save-path selection', async () => {
    const { controller, deps } = harness();
    const result = await controller.exportAttachment({ digest: `sha256:${'a'.repeat(64)}`, suggestedName: 'devis.pdf' });
    expect(result).toEqual({
      exported: true,
      digest: `sha256:${'a'.repeat(64)}`,
      path: 'C:\\Exports\\mail-attachment.bin',
      bytes: 9,
    });
    expect(deps.confirmLocal).toHaveBeenCalledWith(expect.objectContaining({
      action: expect.objectContaining({ name: 'mail.attachment.export', digest: `sha256:${'a'.repeat(64)}` }),
    }));
    expect(deps.selectAttachmentExportPath).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'devis.pdf' }));
    expect(deps.writer.writeAtomic).toHaveBeenCalledWith({
      path: 'C:\\Exports\\mail-attachment.bin',
      content: Buffer.from('PDF bytes'),
      encoding: null,
    });
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
      'mina:mail:export-attachment',
    ]);
    await expect(handlers.get('mina:mail:pause')({}, { accountId: 'personal-imap', extra: true }))
      .rejects.toThrow('mail_ui_request_invalid');
    await handlers.get('mina:mail:pause')({}, { accountId: 'personal-imap' });
    await expect(handlers.get('mina:mail:export-attachment')({}, { digest: `sha256:${'a'.repeat(64)}`, path: 'C:\\unsafe' }))
      .rejects.toThrow('mail_ui_request_invalid');
  });
});
