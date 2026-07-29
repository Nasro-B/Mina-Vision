import { gateResponse } from './response-gate.mjs';

export function createGroundingPipeline({ claimLedger, evidenceValidator } = {}) {
  if (!claimLedger?.add || !claimLedger?.applyValidation) {
    throw new TypeError('grounding_pipeline_claim_ledger_required');
  }
  if (!evidenceValidator?.validate) throw new TypeError('grounding_pipeline_evidence_validator_required');

  return Object.freeze({
    recordAndValidate({ workSessionId, claims, evidence } = {}) {
      if (!Array.isArray(claims)) throw new TypeError('grounding_pipeline_claims_required');
      if (!Array.isArray(evidence)) throw new TypeError('grounding_pipeline_evidence_required');
      const validatedClaims = claims.map(({ text, kind, sourceRefs } = {}) => {
        const claim = claimLedger.add({
          sessionId: workSessionId,
          text,
          kind,
          sourceRefs,
          status: 'unsupported',
        });
        const validation = evidenceValidator.validate(claim, evidence);
        return claimLedger.applyValidation({ claimId: claim.claimId, validation });
      });
      return Object.freeze(validatedClaims);
    },
    gate({ draft, claims, citations, channel } = {}) {
      return gateResponse({ draft, claims, citations, channel });
    },
  });
}
