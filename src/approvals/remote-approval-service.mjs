import { randomUUID } from 'node:crypto';
import { validateApprovalRequestInput, computeApprovalDigest, assertWithinApprovalWindow } from './approval-contracts.mjs';

export function createRemoteApprovalService({ ownerIdentity, approvalVerifier, clock } = {}) {
  if (!ownerIdentity?.isOwner) throw new TypeError('remote_approval_service_owner_identity_required');
  if (!approvalVerifier?.verify) throw new TypeError('remote_approval_service_verifier_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('remote_approval_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const records = new Map();

  function requireRecord(approvalId) {
    const record = records.get(approvalId);
    if (!record) throw new Error('approval_not_found');
    return record;
  }

  function expireIfPast(record) {
    if ((record.status === 'pending' || record.status === 'approved') && Date.parse(record.expiresAt) <= now()) {
      const expired = Object.freeze({ ...record, status: 'expired' });
      records.set(record.approvalId, expired);
      return expired;
    }
    return record;
  }

  return Object.freeze({
    async request(input) {
      const parsed = validateApprovalRequestInput(input);
      if (parsed.locality === 'local_only') throw new Error('approval_local_only_forbidden_remote');
      assertWithinApprovalWindow(parsed.expiresAt, now());

      const digest = computeApprovalDigest(parsed);
      const record = Object.freeze({
        approvalId: randomUUID(), ...parsed, digest, status: 'pending', createdAt: new Date(now()).toISOString(),
      });
      records.set(record.approvalId, record);
      return record;
    },

    async approve({ approvalId, ownerTelegramId, callbackDigest }) {
      let record = expireIfPast(requireRecord(approvalId));
      if (!(await ownerIdentity.isOwner(ownerTelegramId))) throw new Error('approval_non_owner_forbidden');
      if (record.status !== 'pending') throw new Error(`approval_not_pending:${record.status}`);
      if (callbackDigest !== record.digest) throw new Error('approval_digest_mismatch');

      record = Object.freeze({ ...record, status: 'approved', approvedAt: new Date(now()).toISOString() });
      records.set(approvalId, record);
      return record;
    },

    async deny({ approvalId, ownerTelegramId, callbackDigest }) {
      let record = expireIfPast(requireRecord(approvalId));
      if (!(await ownerIdentity.isOwner(ownerTelegramId))) throw new Error('approval_non_owner_forbidden');
      if (record.status !== 'pending') throw new Error(`approval_not_pending:${record.status}`);
      if (callbackDigest !== record.digest) throw new Error('approval_digest_mismatch');

      record = Object.freeze({ ...record, status: 'denied', deniedAt: new Date(now()).toISOString() });
      records.set(approvalId, record);
      return record;
    },

    async consume(approvalId) {
      const record = expireIfPast(requireRecord(approvalId));
      if (record.status === 'consumed') throw new Error('approval_already_consumed');
      if (record.status !== 'approved') throw new Error(`approval_not_approved:${record.status}`);

      const verdict = await approvalVerifier.verify(record);
      if (!verdict.verified) throw new Error(verdict.reason);

      const consumed = Object.freeze({ ...record, status: 'consumed', consumedAt: new Date(now()).toISOString() });
      records.set(approvalId, consumed);
      return consumed;
    },

    async invalidate(approvalId) {
      const record = requireRecord(approvalId);
      if (record.status === 'consumed') throw new Error('approval_already_consumed');
      const invalidated = Object.freeze({ ...record, status: 'invalidated', invalidatedAt: new Date(now()).toISOString() });
      records.set(approvalId, invalidated);
      return invalidated;
    },

    async get(approvalId) {
      return expireIfPast(requireRecord(approvalId));
    },
  });
}
