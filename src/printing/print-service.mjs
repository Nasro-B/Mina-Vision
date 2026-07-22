import { randomUUID } from 'node:crypto';

export const PRINT_STATES = Object.freeze(['accepted_by_spooler', 'printing', 'completed', 'failed', 'state_unknown']);

export function createPrintService({ printerRegistry, spooler, actionVerifier, clock } = {}) {
  if (!printerRegistry?.isApproved) throw new TypeError('print_service_printer_registry_required');
  if (!spooler?.submit || !spooler?.getStatus) throw new TypeError('print_service_spooler_required');
  if (!actionVerifier?.verify) throw new TypeError('print_service_action_verifier_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('print_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const jobsByProposalId = new Map();

  return Object.freeze({
    async proposePrint({ digest, printerId, pages, copies = 1, duplex = false, color = false, media = 'A4', estimatedSheets }) {
      if (!(await printerRegistry.isApproved(printerId))) throw new Error('printer_not_approved');
      if (typeof digest !== 'string' || digest.length === 0) throw new TypeError('print_proposal_digest_required');
      return Object.freeze({
        proposalId: randomUUID(), digest, printerId, pages, copies, duplex, color, media,
        estimatedSheets: estimatedSheets ?? (Array.isArray(pages) ? pages.length * copies : copies),
        status: 'proposed', proposedAt: new Date(now()).toISOString(),
      });
    },

    async submit(proposal) {
      const existing = jobsByProposalId.get(proposal.proposalId);
      if (existing) return existing;

      const receipt = await spooler.submit({
        digest: proposal.digest, printerId: proposal.printerId, pages: proposal.pages,
        copies: proposal.copies, duplex: proposal.duplex, color: proposal.color, media: proposal.media,
      });
      const job = Object.freeze({ jobId: receipt.jobId, proposalId: proposal.proposalId, status: 'accepted_by_spooler', submittedAt: new Date(now()).toISOString() });
      jobsByProposalId.set(proposal.proposalId, job);
      return job;
    },

    async reconcile(jobId) {
      let statusReport;
      try {
        statusReport = await spooler.getStatus(jobId);
      } catch {
        return Object.freeze({ jobId, status: 'state_unknown' });
      }
      if (!statusReport || !PRINT_STATES.includes(statusReport.status)) {
        return Object.freeze({ jobId, status: 'state_unknown' });
      }
      if (statusReport.status === 'completed') {
        const evidence = await actionVerifier.verify({ action: { name: 'print.job' }, receipt: statusReport, expectedEffect: { jobId } });
        if (!evidence.confirmed) return Object.freeze({ jobId, status: 'state_unknown' });
      }
      return Object.freeze({ jobId, status: statusReport.status });
    },
  });
}
