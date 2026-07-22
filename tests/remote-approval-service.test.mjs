import { describe, expect, it, vi } from 'vitest';
import { createRemoteApprovalService } from '../src/approvals/remote-approval-service.mjs';
import { computeApprovalDigest } from '../src/approvals/approval-contracts.mjs';

const NOW = Date.parse('2026-07-16T10:00:00.000Z');
const OWNER_ID = 111222333;
const STRANGER_ID = 999888777;

function validInput(overrides = {}) {
  return {
    capability: 'home.execute', resourceDigest: `sha256:${'a'.repeat(64)}`, actionDigest: `sha256:${'b'.repeat(64)}`,
    observedStateDigest: `sha256:${'c'.repeat(64)}`, expectedEffect: { state: 'on' }, disclosedData: { device: 'lampe salon' },
    expiresAt: new Date(NOW + 300_000).toISOString(), nonce: 'nonce-1', locality: 'remote_eligible',
    ...overrides,
  };
}

function fakeOwnerIdentity() {
  return { isOwner: vi.fn(async (telegramId) => telegramId === OWNER_ID) };
}

function fakeVerifier(verdict = { verified: true, reason: null }) {
  return { verify: vi.fn(async () => verdict) };
}

function buildService(overrides = {}) {
  return createRemoteApprovalService({ ownerIdentity: fakeOwnerIdentity(), approvalVerifier: fakeVerifier(), clock: () => NOW, ...overrides });
}

describe('createRemoteApprovalService: constructor guards', () => {
  it('requires an ownerIdentity', () => {
    expect(() => createRemoteApprovalService({ approvalVerifier: fakeVerifier(), clock: () => 0 })).toThrow('remote_approval_service_owner_identity_required');
  });
});

describe('createRemoteApprovalService: exact expiry/replay/state lifecycle from the plan', () => {
  it('request -> approve -> consume succeeds once, a second consume throws approval_already_consumed', async () => {
    const service = buildService();
    const request = await service.request(validInput());
    await service.approve({ approvalId: request.approvalId, ownerTelegramId: OWNER_ID, callbackDigest: request.digest });
    await service.consume(request.approvalId);
    await expect(service.consume(request.approvalId)).rejects.toThrow('approval_already_consumed');
  });
});

describe('createRemoteApprovalService.request: local_only always refused remotely', () => {
  it('rejects a local_only capability outright', async () => {
    const service = buildService();
    await expect(service.request(validInput({ locality: 'local_only' }))).rejects.toThrow('approval_local_only_forbidden_remote');
  });
});

describe('createRemoteApprovalService.request: approval window bounded to 5 minutes', () => {
  it('rejects an expiresAt further than 5 minutes out', async () => {
    const service = buildService();
    await expect(service.request(validInput({ expiresAt: new Date(NOW + 300_001).toISOString() }))).rejects.toThrow('approval_window_too_long');
  });

  it('accepts an expiresAt exactly at the 5-minute boundary', async () => {
    const service = buildService();
    await expect(service.request(validInput({ expiresAt: new Date(NOW + 300_000).toISOString() }))).resolves.toMatchObject({ status: 'pending' });
  });

  it('rejects an expiresAt already in the past', async () => {
    const service = buildService();
    await expect(service.request(validInput({ expiresAt: new Date(NOW - 1).toISOString() }))).rejects.toThrow('approval_expires_at_invalid');
  });
});

describe('createRemoteApprovalService: digest sensitivity to recipient/file/amount/device changes', () => {
  it('produces a different digest when the disclosed recipient changes', async () => {
    const a = computeApprovalDigest(validInput({ disclosedData: { recipient: 'Alice' } }));
    const b = computeApprovalDigest(validInput({ disclosedData: { recipient: 'Bob' } }));
    expect(a).not.toBe(b);
  });

  it('produces a different digest when the expected file changes', async () => {
    const a = computeApprovalDigest(validInput({ expectedEffect: { file: 'facture.pdf' } }));
    const b = computeApprovalDigest(validInput({ expectedEffect: { file: 'contrat.pdf' } }));
    expect(a).not.toBe(b);
  });

  it('produces a different digest when the amount changes', async () => {
    const a = computeApprovalDigest(validInput({ expectedEffect: { amountCents: 1000 } }));
    const b = computeApprovalDigest(validInput({ expectedEffect: { amountCents: 2000 } }));
    expect(a).not.toBe(b);
  });

  it('produces a different digest when the target device changes', async () => {
    const a = computeApprovalDigest(validInput({ disclosedData: { device: 'lampe salon' } }));
    const b = computeApprovalDigest(validInput({ disclosedData: { device: 'four cuisine' } }));
    expect(a).not.toBe(b);
  });

  it('produces a different digest when the observed state changes', async () => {
    const a = computeApprovalDigest(validInput({ observedStateDigest: `sha256:${'1'.repeat(64)}` }));
    const b = computeApprovalDigest(validInput({ observedStateDigest: `sha256:${'2'.repeat(64)}` }));
    expect(a).not.toBe(b);
  });
});

describe('createRemoteApprovalService.approve/deny: owner-only, exact digest', () => {
  it('rejects approval from a non-owner Telegram identity', async () => {
    const service = buildService();
    const request = await service.request(validInput());
    await expect(service.approve({ approvalId: request.approvalId, ownerTelegramId: STRANGER_ID, callbackDigest: request.digest }))
      .rejects.toThrow('approval_non_owner_forbidden');
  });

  it('rejects a callback carrying a mismatched digest (tampered/stale callback)', async () => {
    const service = buildService();
    const request = await service.request(validInput());
    await expect(service.approve({ approvalId: request.approvalId, ownerTelegramId: OWNER_ID, callbackDigest: 'sha256:' + 'f'.repeat(64) }))
      .rejects.toThrow('approval_digest_mismatch');
  });

  it('deny transitions to denied and blocks any future consume', async () => {
    const service = buildService();
    const request = await service.request(validInput());
    await service.deny({ approvalId: request.approvalId, ownerTelegramId: OWNER_ID, callbackDigest: request.digest });
    await expect(service.consume(request.approvalId)).rejects.toThrow('approval_not_approved:denied');
  });

  it('rejects approving an already-approved request twice', async () => {
    const service = buildService();
    const request = await service.request(validInput());
    await service.approve({ approvalId: request.approvalId, ownerTelegramId: OWNER_ID, callbackDigest: request.digest });
    await expect(service.approve({ approvalId: request.approvalId, ownerTelegramId: OWNER_ID, callbackDigest: request.digest }))
      .rejects.toThrow('approval_not_pending:approved');
  });
});

describe('createRemoteApprovalService: expiry transitions', () => {
  it('auto-expires a pending request once past expiresAt, rejecting approval', async () => {
    let clockValue = NOW;
    const service = buildService({ clock: () => clockValue });
    const request = await service.request(validInput());
    clockValue = NOW + 300_001;
    await expect(service.approve({ approvalId: request.approvalId, ownerTelegramId: OWNER_ID, callbackDigest: request.digest }))
      .rejects.toThrow('approval_not_pending:expired');
  });

  it('auto-expires an approved-but-unconsumed request past expiresAt', async () => {
    let clockValue = NOW;
    const service = buildService({ clock: () => clockValue });
    const request = await service.request(validInput());
    await service.approve({ approvalId: request.approvalId, ownerTelegramId: OWNER_ID, callbackDigest: request.digest });
    clockValue = NOW + 300_001;
    await expect(service.consume(request.approvalId)).rejects.toThrow('approval_not_approved:expired');
  });
});

describe('createRemoteApprovalService.consume: re-observes state and re-runs policy', () => {
  it('rejects consumption when the state changed since approval', async () => {
    const approvalVerifier = fakeVerifier({ verified: false, reason: 'approval_state_changed' });
    const service = buildService({ approvalVerifier });
    const request = await service.request(validInput());
    await service.approve({ approvalId: request.approvalId, ownerTelegramId: OWNER_ID, callbackDigest: request.digest });
    await expect(service.consume(request.approvalId)).rejects.toThrow('approval_state_changed');
  });

  it('rejects consumption when policy no longer allows it', async () => {
    const approvalVerifier = fakeVerifier({ verified: false, reason: 'approval_policy_changed' });
    const service = buildService({ approvalVerifier });
    const request = await service.request(validInput());
    await service.approve({ approvalId: request.approvalId, ownerTelegramId: OWNER_ID, callbackDigest: request.digest });
    await expect(service.consume(request.approvalId)).rejects.toThrow('approval_policy_changed');
  });

  it('rejects consuming a never-approved (still pending) request', async () => {
    const service = buildService();
    const request = await service.request(validInput());
    await expect(service.consume(request.approvalId)).rejects.toThrow('approval_not_approved:pending');
  });
});

describe('createRemoteApprovalService.invalidate', () => {
  it('cancels a pending request, blocking future approval', async () => {
    const service = buildService();
    const request = await service.request(validInput());
    await service.invalidate(request.approvalId);
    await expect(service.approve({ approvalId: request.approvalId, ownerTelegramId: OWNER_ID, callbackDigest: request.digest }))
      .rejects.toThrow('approval_not_pending:invalidated');
  });

  it('rejects invalidating an already-consumed approval', async () => {
    const service = buildService();
    const request = await service.request(validInput());
    await service.approve({ approvalId: request.approvalId, ownerTelegramId: OWNER_ID, callbackDigest: request.digest });
    await service.consume(request.approvalId);
    await expect(service.invalidate(request.approvalId)).rejects.toThrow('approval_already_consumed');
  });
});

describe('createRemoteApprovalService.get', () => {
  it('rejects fetching an unknown approvalId', async () => {
    const service = buildService();
    await expect(service.get('missing')).rejects.toThrow('approval_not_found');
  });
});
