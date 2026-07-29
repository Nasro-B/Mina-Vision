import { describe, expect, it, vi } from 'vitest';
import { createImapSmtpAdapter, pinnedCertCheck } from '../src/mail/adapters/imap-smtp.mjs';

const account = Object.freeze({
  id: 'personal-imap', address: 'nasro@example.test', provider: 'imap-smtp',
  imap: { host: 'imap.example.test', port: 993, secure: true },
  smtp: { host: 'smtp.example.test', port: 587, secure: false, starttls: true },
});

describe('IMAP/SMTP secure adapter', () => {
  it('rejects plaintext transport and disabled certificate validation', () => {
    expect(() => createImapSmtpAdapter({
      account: { ...account, imap: { host: 'imap.example.test', port: 143, secure: false, starttls: false } },
      credentialsProvider: async () => ({}),
    })).toThrow('imap_tls_required');
    expect(() => createImapSmtpAdapter({
      account: { ...account, smtp: { ...account.smtp, rejectUnauthorized: false } },
      credentialsProvider: async () => ({}),
    })).toThrow('mail_certificate_validation_required');
  });

  it('persists normalized untrusted messages before returning an advanced UID cursor', async () => {
    const persisted = [];
    const logout = vi.fn(async () => {});
    const client = {
      mailbox: { uidValidity: 77n },
      connect: vi.fn(async () => {}),
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      fetch: vi.fn(() => (async function* values() {
        yield { uid: 12, source: Buffer.from('raw-12') };
        yield { uid: 13, source: Buffer.from('raw-13') };
      }())),
      logout,
    };
    const adapter = createImapSmtpAdapter({
      account,
      credentialsProvider: vi.fn(async () => ({ user: account.address, password: 'app-password' })),
      imapFactory: vi.fn(() => client),
      parseMessage: vi.fn(async (source) => ({
        messageId: `<${source.toString()}>`, subject: 'Facture', text: 'Contenu',
        from: { value: [{ address: 'sender@example.test', name: 'Sender' }] },
        to: { value: [{ address: account.address }] }, date: new Date('2026-07-15T10:00:00Z'), attachments: [],
      })),
    });

    const result = await adapter.sync({ folder: 'INBOX', cursor: { uidValidity: '77', lastUid: 11 }, persist: async (message) => persisted.push(message) });
    expect(result).toEqual({ uidValidity: '77', lastUid: 13, imported: 2 });
    expect(persisted[0]).toMatchObject({ providerMessageId: '<raw-12>', trust: 'external_untrusted', bodyText: 'Contenu' });
    expect(client.fetch).toHaveBeenCalledWith('12:*', expect.objectContaining({ uid: true, source: true }), { uid: true });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('enforces SMTP TLS and qualifies provider acceptance without claiming delivery', async () => {
    const sendMail = vi.fn(async () => ({ messageId: '<mina-1@example.test>', response: '250 queued' }));
    const smtpFactory = vi.fn(() => ({ verify: vi.fn(async () => true), sendMail, close: vi.fn() }));
    const adapter = createImapSmtpAdapter({
      account,
      credentialsProvider: vi.fn(async () => ({ user: account.address, password: 'app-password' })),
      smtpFactory,
    });

    await expect(adapter.send({
      messageId: '<mina-1@example.test>', to: ['client@example.test'], subject: 'Bonjour', text: 'Message',
    })).resolves.toEqual({ state: 'accepted_by_provider', providerMessageId: '<mina-1@example.test>', responseCode: 250 });
    expect(smtpFactory).toHaveBeenCalledWith(expect.objectContaining({
      secure: false, requireTLS: true, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    }));
  });

  it('marks a connection loss after DATA as delivery unknown instead of retrying blindly', async () => {
    const error = Object.assign(new Error('socket closed'), { command: 'DATA' });
    const adapter = createImapSmtpAdapter({
      account,
      credentialsProvider: async () => ({ user: account.address, password: 'app-password' }),
      smtpFactory: () => ({ verify: async () => true, sendMail: async () => { throw error; }, close: () => {} }),
    });

    await expect(adapter.send({
      messageId: '<mina-2@example.test>', to: ['client@example.test'], subject: 'Bonjour', text: 'Message',
    })).resolves.toEqual({ state: 'delivery_unknown', providerMessageId: '<mina-2@example.test>' });
  });

  it('falls back to a canonical digest identity when the Message-ID header is missing', async () => {
    const persisted = [];
    const client = {
      mailbox: { uidValidity: 77n },
      connect: vi.fn(async () => {}),
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      fetch: vi.fn(() => (async function* values() { yield { uid: 20, source: Buffer.from('raw-20') }; }())),
      logout: vi.fn(async () => {}),
    };
    const adapter = createImapSmtpAdapter({
      account, credentialsProvider: async () => ({ user: account.address, password: 'app-password' }),
      imapFactory: vi.fn(() => client),
      parseMessage: vi.fn(async () => ({
        subject: 'Sans Message-ID', text: 'Contenu',
        from: { value: [{ address: 'sender@example.test' }] }, to: { value: [{ address: account.address }] },
      })),
    });

    await adapter.sync({ folder: 'INBOX', persist: async (message) => persisted.push(message) });
    expect(persisted[0].providerMessageId).toMatch(/^digest:sha256:[a-f0-9]{64}$/u);
  });

  it('rebuilds from UID 1 and dedups by the new identity when UIDVALIDITY changes', async () => {
    const client = {
      mailbox: { uidValidity: 88n },
      connect: vi.fn(async () => {}),
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      fetch: vi.fn(() => (async function* values() { yield { uid: 1, source: Buffer.from('raw-1') }; }())),
      logout: vi.fn(async () => {}),
    };
    const adapter = createImapSmtpAdapter({
      account, credentialsProvider: async () => ({ user: account.address, password: 'app-password' }),
      imapFactory: vi.fn(() => client),
      parseMessage: vi.fn(async (source) => ({ messageId: `<${source.toString()}>`, from: { value: [] }, to: { value: [] } })),
    });

    const result = await adapter.sync({ folder: 'INBOX', cursor: { uidValidity: '77', lastUid: 50 }, persist: async () => {} });
    expect(result.uidValidity).toBe('88');
    expect(client.fetch).toHaveBeenCalledWith('1:*', expect.anything(), expect.anything());
  });
});

describe('IMAP/SMTP adapter: certificate fingerprint pinning', () => {
  it('accepts a self-signed certificate only when its exact SHA-256 fingerprint was locally pinned', () => {
    const check = pinnedCertCheck('ab'.repeat(32));
    expect(check('imap.example.test', { fingerprint256: 'AB:'.repeat(31) + 'AB' })).toBeUndefined();
  });

  it('rejects a certificate whose fingerprint does not match the pinned value', () => {
    const check = pinnedCertCheck('ab'.repeat(32));
    const result = check('imap.example.test', { fingerprint256: 'cd:'.repeat(31) + 'cd' });
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('mail_pinned_fingerprint_mismatch');
  });

  it('rejects a malformed pinned fingerprint at configuration time rather than silently ignoring it', () => {
    expect(() => createImapSmtpAdapter({
      account: { ...account, imap: { ...account.imap, pinnedFingerprintSha256: 'not-a-fingerprint' } },
      credentialsProvider: async () => ({}),
    })).toThrow('imap_pinned_fingerprint_invalid');
  });
});

describe('IMAP/SMTP adapter: IDLE with renewal, falling back to bounded polling', () => {
  it('renews an IDLE wait that times out internally instead of treating it as a real change', async () => {
    let idleCalls = 0;
    const client = {
      connect: vi.fn(async () => {}),
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      idle: vi.fn(async () => { idleCalls += 1; }),
      logout: vi.fn(async () => {}),
    };
    const adapter = createImapSmtpAdapter({
      account, credentialsProvider: async () => ({ user: account.address, password: 'app-password' }),
      imapFactory: vi.fn(() => client),
    });

    const result = await adapter.idle({ folder: 'INBOX', renewAfterMs: 10, maxWaitMs: 35 });
    expect(result.supportsIdle).toBe(true);
    expect(idleCalls).toBeGreaterThanOrEqual(2);
  });

  it('reports polling required when the connected client has no idle capability', async () => {
    const client = {
      connect: vi.fn(async () => {}),
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      logout: vi.fn(async () => {}),
    };
    const adapter = createImapSmtpAdapter({
      account, credentialsProvider: async () => ({ user: account.address, password: 'app-password' }),
      imapFactory: vi.fn(() => client),
    });

    await expect(adapter.idle({ folder: 'INBOX' })).resolves.toEqual({ supportsIdle: false });
  });
});

describe('IMAP/SMTP adapter: mark read is idempotent and post-write verified', () => {
  it('sets \\Seen by UID and verifies the selected message flags', async () => {
    const client = {
      connect: vi.fn(async () => {}),
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      messageFlagsAdd: vi.fn(async () => true),
      fetchOne: vi.fn(async () => ({ uid: 42, flags: new Set(['\\Seen']) })),
      logout: vi.fn(async () => {}),
    };
    const adapter = createImapSmtpAdapter({
      account,
      credentialsProvider: async () => ({ user: account.address, password: 'app-password' }),
      imapFactory: vi.fn(async () => client),
    });

    await expect(adapter.markRead({ folder: 'INBOX', uid: 42 }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'INBOX:42' });
    expect(client.messageFlagsAdd).toHaveBeenCalledWith(42, ['\\Seen'], { uid: true });
    expect(client.fetchOne).toHaveBeenCalledWith(42, { uid: true, flags: true }, { uid: true });
  });

  it('does not claim confirmation when the post-write fetch is not seen', async () => {
    const client = {
      connect: vi.fn(async () => {}),
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      messageFlagsAdd: vi.fn(async () => true),
      fetchOne: vi.fn(async () => ({ uid: 42, flags: new Set() })),
      logout: vi.fn(async () => {}),
    };
    const adapter = createImapSmtpAdapter({
      account,
      credentialsProvider: async () => ({ user: account.address, password: 'app-password' }),
      imapFactory: vi.fn(async () => client),
    });

    await expect(adapter.markRead({ folder: 'INBOX', uid: 42 }))
      .rejects.toThrow('imap_mark_read_unconfirmed');
  });
});

describe('IMAP/SMTP adapter: archive requires an explicit destination and post-write proof', () => {
  it('moves by source UID then rereads the mapped destination UID', async () => {
    const sourceClient = {
      connect: vi.fn(async () => {}),
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      messageMove: vi.fn(async () => ({ destination: 'Archive', uidMap: new Map([[42, 88]]) })),
      logout: vi.fn(async () => {}),
    };
    const destinationClient = {
      connect: vi.fn(async () => {}),
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      fetchOne: vi.fn(async () => ({ uid: 88 })),
      logout: vi.fn(async () => {}),
    };
    const clients = [sourceClient, destinationClient];
    const adapter = createImapSmtpAdapter({
      account,
      credentialsProvider: async () => ({ user: account.address, password: 'app-password' }),
      imapFactory: vi.fn(async () => clients.shift()),
    });

    await expect(adapter.archive({ folder: 'INBOX', uid: 42, archiveFolder: 'Archive' }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'Archive:88' });
    expect(sourceClient.messageMove).toHaveBeenCalledWith(42, 'Archive', { uid: true });
    expect(destinationClient.fetchOne).toHaveBeenCalledWith(88, { uid: true }, { uid: true });
  });

  it('reports delivery_unknown instead of inventing confirmation without UIDPLUS mapping', async () => {
    const sourceClient = {
      connect: vi.fn(async () => {}),
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      messageMove: vi.fn(async () => ({ destination: 'Archive' })),
      logout: vi.fn(async () => {}),
    };
    const adapter = createImapSmtpAdapter({
      account,
      credentialsProvider: async () => ({ user: account.address, password: 'app-password' }),
      imapFactory: vi.fn(async () => sourceClient),
    });

    await expect(adapter.archive({ folder: 'INBOX', uid: 42, archiveFolder: 'Archive' }))
      .resolves.toEqual({ state: 'delivery_unknown', providerMessageId: 'INBOX:42' });
  });
});

describe('IMAP/SMTP adapter: search Sent before any retry', () => {
  it('finds a previously sent message in Sent by Message-ID so a retry is never blind', async () => {
    const client = {
      connect: vi.fn(async () => {}),
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      search: vi.fn(async () => [42]),
      logout: vi.fn(async () => {}),
    };
    const adapter = createImapSmtpAdapter({
      account, credentialsProvider: async () => ({ user: account.address, password: 'app-password' }),
      imapFactory: vi.fn(() => client),
    });

    await expect(adapter.searchSent({ messageId: '<mina-2@example.test>' })).resolves.toEqual({ found: true, uids: [42] });
    expect(client.search).toHaveBeenCalledWith({ header: { 'message-id': '<mina-2@example.test>' } }, { uid: true });
  });

  it('reports not found when nothing matches in Sent', async () => {
    const client = {
      connect: vi.fn(async () => {}), getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      search: vi.fn(async () => []), logout: vi.fn(async () => {}),
    };
    const adapter = createImapSmtpAdapter({
      account, credentialsProvider: async () => ({ user: account.address, password: 'app-password' }),
      imapFactory: vi.fn(() => client),
    });
    await expect(adapter.searchSent({ messageId: '<ghost@example.test>' })).resolves.toEqual({ found: false, uids: [] });
  });
});

describe('IMAP/SMTP adapter: declared operation capability boundary', () => {
  it('does not advertise a draft or mailbox mutation API it does not implement', () => {
    const adapter = createImapSmtpAdapter({ account, credentialsProvider: async () => ({ user: account.address, password: 'app-password' }) });

    expect(adapter.capabilities).toContain('send');
    expect(adapter.capabilities).not.toContain('createDraft');
    expect(adapter.capabilities).not.toContain('unsubscribe');
  });
});
