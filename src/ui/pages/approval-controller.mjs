export function createApprovalController({ remoteApprovalService } = {}) {
  if (!remoteApprovalService?.request || !remoteApprovalService?.approve || !remoteApprovalService?.deny
    || !remoteApprovalService?.consume || !remoteApprovalService?.get) {
    throw new TypeError('approval_controller_dependencies_required');
  }

  return Object.freeze({
    // Normalizes the service's internal `approval_local_only_forbidden_remote` throw (the real
    // mechanism behind "local_only always refused remotely") into a stable, renderer-facing
    // decision object. Any other request failure (window too long, malformed digest input, etc.)
    // is a genuine input error and is left to propagate, never silently folded into 'deny'.
    async remoteApprove(request) {
      try {
        const record = await remoteApprovalService.request(request);
        return Object.freeze({ decision: 'pending', approvalId: record.approvalId, digest: record.digest, expiresAt: record.expiresAt });
      } catch (error) {
        if (error.message === 'approval_local_only_forbidden_remote') {
          return Object.freeze({ decision: 'deny', reason: 'local_confirmation_required' });
        }
        throw error;
      }
    },

    approve: (input) => remoteApprovalService.approve(input),
    deny: (input) => remoteApprovalService.deny(input),
    consume: (approvalId) => remoteApprovalService.consume(approvalId),
    get: (approvalId) => remoteApprovalService.get(approvalId),
  });
}
