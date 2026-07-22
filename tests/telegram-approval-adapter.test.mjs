import { describe, expect, it, vi } from 'vitest';
import { createTelegramApprovalAdapter } from '../src/messaging/telegram-approval-adapter.mjs';

const OWNER_ID = 111222333;
const STRANGER_ID = 999888777;
const APPROVAL_ID = '11111111-2222-3333-4444-555555555555';
const DIGEST_HEX = 'a'.repeat(64);
const DIGEST = `sha256:${DIGEST_HEX}`;

function fakeAudit() {
  const events = [];
  return { events, record: vi.fn((event) => { events.push(event); }), last: () => events.at(-1) };
}

function fakeTransport() {
  return { sendMessage: vi.fn(async () => ({ messageId: 'm1' })) };
}

function fakeApprovalService(overrides = {}) {
  return {
    approve: vi.fn(async () => ({ approvalId: APPROVAL_ID, status: 'approved' })),
    deny: vi.fn(async () => ({ approvalId: APPROVAL_ID, status: 'denied' })),
    get: vi.fn(async () => ({
      approvalId: APPROVAL_ID, capability: 'home.execute', resourceDigest: 'sha256:res', observedStateDigest: 'sha256:state',
      expectedEffect: { state: 'on' }, disclosedData: { device: 'lampe' }, expiresAt: '2026-07-16T10:05:00.000Z', digest: DIGEST,
    })),
    ...overrides,
  };
}

function buildAdapter(overrides = {}) {
  const isOwner = vi.fn(async (id) => id === OWNER_ID);
  const audit = fakeAudit();
  const transport = fakeTransport();
  const approvalService = fakeApprovalService(overrides.approvalServiceOverrides);
  const adapter = createTelegramApprovalAdapter({ approvalService, isOwner, transport, audit, ...overrides });
  return { adapter, isOwner, audit, transport, approvalService };
}

describe('createTelegramApprovalAdapter: constructor guards', () => {
  it('requires an approvalService', () => {
    expect(() => createTelegramApprovalAdapter({ isOwner: vi.fn(), transport: fakeTransport(), audit: fakeAudit() }))
      .toThrow('telegram_approval_adapter_service_required');
  });
});

describe('createTelegramApprovalAdapter.handleCallback: exact plan example (non-owner denied)', () => {
  it('never calls approve for a stranger, and audits identity denial', async () => {
    const { adapter, approvalService, audit } = buildAdapter();
    await adapter.handleCallback({ from: { id: STRANGER_ID }, data: `approve:${APPROVAL_ID}:${DIGEST_HEX}` });
    expect(approvalService.approve).not.toHaveBeenCalled();
    expect(audit.last().type).toBe('remote_approval_denied_identity');
  });
});

describe('createTelegramApprovalAdapter.handleCallback: exact callback regex', () => {
  it('rejects a callback with a malformed action', async () => {
    const { adapter, approvalService, audit } = buildAdapter();
    await adapter.handleCallback({ from: { id: OWNER_ID }, data: `execute:${APPROVAL_ID}:${DIGEST_HEX}` });
    expect(approvalService.approve).not.toHaveBeenCalled();
    expect(audit.last().type).toBe('remote_approval_malformed_callback');
  });

  it('rejects a callback with a malformed approvalId (not a UUID)', async () => {
    const { adapter, audit } = buildAdapter();
    await adapter.handleCallback({ from: { id: OWNER_ID }, data: `approve:not-a-uuid:${DIGEST_HEX}` });
    expect(audit.last().type).toBe('remote_approval_malformed_callback');
  });

  it('rejects a callback with a malformed digest (wrong length / non-hex)', async () => {
    const { adapter, audit } = buildAdapter();
    await adapter.handleCallback({ from: { id: OWNER_ID }, data: `approve:${APPROVAL_ID}:not-hex` });
    expect(audit.last().type).toBe('remote_approval_malformed_callback');
  });

  it('rejects a callback carrying extra unexpected trailing data (anchored regex)', async () => {
    const { adapter, audit } = buildAdapter();
    await adapter.handleCallback({ from: { id: OWNER_ID }, data: `approve:${APPROVAL_ID}:${DIGEST_HEX}:extra` });
    expect(audit.last().type).toBe('remote_approval_malformed_callback');
  });

  it('accepts a well-formed approve callback from the owner', async () => {
    const { adapter, approvalService } = buildAdapter();
    await adapter.handleCallback({ from: { id: OWNER_ID }, data: `approve:${APPROVAL_ID}:${DIGEST_HEX}` });
    expect(approvalService.approve).toHaveBeenCalledWith({ approvalId: APPROVAL_ID, ownerTelegramId: OWNER_ID, callbackDigest: DIGEST });
  });
});

describe('createTelegramApprovalAdapter.handleCallback: approve/deny/proofs dispatch', () => {
  it('deny calls approvalService.deny, not approve', async () => {
    const { adapter, approvalService } = buildAdapter();
    await adapter.handleCallback({ from: { id: OWNER_ID }, data: `deny:${APPROVAL_ID}:${DIGEST_HEX}` });
    expect(approvalService.deny).toHaveBeenCalledTimes(1);
    expect(approvalService.approve).not.toHaveBeenCalled();
  });

  it('proofs reads the approval without approving or denying it', async () => {
    const { adapter, approvalService } = buildAdapter();
    const result = await adapter.handleCallback({ from: { id: OWNER_ID }, data: `proofs:${APPROVAL_ID}:${DIGEST_HEX}` });
    expect(approvalService.approve).not.toHaveBeenCalled();
    expect(approvalService.deny).not.toHaveBeenCalled();
    expect(approvalService.get).toHaveBeenCalledWith(APPROVAL_ID);
    expect(result.reply).toContain('home.execute');
  });

  it('audits and replies gracefully when approve fails (e.g. already consumed)', async () => {
    const approvalServiceOverrides = { approve: vi.fn(async () => { throw new Error('approval_already_consumed'); }) };
    const { adapter, audit } = buildAdapter({ approvalServiceOverrides });
    const result = await adapter.handleCallback({ from: { id: OWNER_ID }, data: `approve:${APPROVAL_ID}:${DIGEST_HEX}` });
    expect(audit.last().type).toBe('remote_approval_callback_failed');
    expect(result.reply).toContain('approval_already_consumed');
  });
});

describe('createTelegramApprovalAdapter.sendRequest: bounded summary and buttons', () => {
  it('sends a summary containing action/resource/state/expected effect/disclosures/expiry', async () => {
    const { adapter, transport, approvalService } = buildAdapter();
    const approval = await approvalService.get(APPROVAL_ID);
    await adapter.sendRequest(approval);
    const [{ text }] = transport.sendMessage.mock.calls[0];
    expect(text).toContain('home.execute');
    expect(text).toContain('lampe');
    expect(text).toContain('2026-07-16T10:05:00.000Z');
  });

  it('builds exactly the three approve|deny|proofs buttons with the bare-hex digest (no sha256: prefix)', async () => {
    const { adapter, transport, approvalService } = buildAdapter();
    const approval = await approvalService.get(APPROVAL_ID);
    await adapter.sendRequest(approval);
    const [{ buttons }] = transport.sendMessage.mock.calls[0];
    expect(buttons.map((b) => b.callbackData)).toEqual([
      `approve:${APPROVAL_ID}:${DIGEST_HEX}`, `deny:${APPROVAL_ID}:${DIGEST_HEX}`, `proofs:${APPROVAL_ID}:${DIGEST_HEX}`,
    ]);
  });
});
