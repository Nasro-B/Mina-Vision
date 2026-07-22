import { describe, expect, it } from 'vitest';
import { normalizeMessageIdentity, validateMailAccount } from '../src/mail/mail-contracts.mjs';

const BASE_ACCOUNT = Object.freeze({
  id: 'personal-imap', provider: 'imap-smtp', address: 'nasro@example.test',
  capabilities: ['sync', 'send'], mode: 3, syncState: { cursor: null },
});

describe('mail account contract', () => {
  it('accepts a well-formed account for each of the three provider families', () => {
    for (const provider of ['gmail', 'microsoft', 'imap-smtp']) {
      expect(() => validateMailAccount({ ...BASE_ACCOUNT, provider })).not.toThrow();
    }
  });

  it('rejects an unknown provider family', () => {
    expect(() => validateMailAccount({ ...BASE_ACCOUNT, provider: 'yahoo' })).toThrow('mail_account_invalid');
  });

  it('rejects an address without an @ sign', () => {
    expect(() => validateMailAccount({ ...BASE_ACCOUNT, address: 'not-an-address' })).toThrow('mail_account_invalid');
  });

  it('rejects a mode outside 1, 2, or 3', () => {
    expect(() => validateMailAccount({ ...BASE_ACCOUNT, mode: 4 })).toThrow('mail_account_invalid');
  });

  it('freezes the normalized account and its nested arrays', () => {
    const account = validateMailAccount(BASE_ACCOUNT);
    expect(Object.isFrozen(account)).toBe(true);
    expect(Object.isFrozen(account.capabilities)).toBe(true);
  });
});

describe('normalized message identity per provider', () => {
  it('deduplicates Gmail messages by message id, thread id, and history id', () => {
    const a = normalizeMessageIdentity({ provider: 'gmail', gmailId: 'm1', threadId: 't1', historyId: 'h1' });
    const b = normalizeMessageIdentity({ provider: 'gmail', gmailId: 'm1', threadId: 't1', historyId: 'h2' });
    expect(a.dedupKey).toBe(b.dedupKey);
    expect(a.dedupKey).toContain('gmail:m1:t1');
  });

  it('deduplicates Microsoft messages by id and internet message id, independent of the delta cursor', () => {
    const a = normalizeMessageIdentity({ provider: 'microsoft', graphId: 'g1', internetMessageId: '<x@y>' });
    const b = normalizeMessageIdentity({ provider: 'microsoft', graphId: 'g1', internetMessageId: '<x@y>', deltaCursor: 'later' });
    expect(a.dedupKey).toBe(b.dedupKey);
  });

  it('deduplicates IMAP messages by account, folder, UIDVALIDITY, and UID, falling back to Message-ID and digest', () => {
    const identity = normalizeMessageIdentity({
      provider: 'imap-smtp', accountId: 'personal-imap', folder: 'INBOX', uidValidity: '77', uid: 12,
      messageIdHeader: '<raw-12>', digest: 'sha256:abc',
    });
    expect(identity.dedupKey).toBe('imap-smtp:personal-imap:INBOX:77:12');
    expect(identity.messageIdHeader).toBe('<raw-12>');
    expect(identity.digest).toBe('sha256:abc');
  });

  it('rejects an IMAP identity missing a UIDVALIDITY', () => {
    expect(() => normalizeMessageIdentity({ provider: 'imap-smtp', accountId: 'a', folder: 'INBOX', uid: 1 }))
      .toThrow('mail_message_identity_invalid');
  });

  it('rejects an unsupported provider', () => {
    expect(() => normalizeMessageIdentity({ provider: 'yahoo' })).toThrow('mail_message_identity_invalid');
  });
});
