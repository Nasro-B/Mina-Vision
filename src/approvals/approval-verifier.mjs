export function createApprovalVerifier({ stateObserver, capabilityBroker } = {}) {
  if (!stateObserver?.observe) throw new TypeError('approval_verifier_state_observer_required');
  if (!capabilityBroker?.authorize) throw new TypeError('approval_verifier_capability_broker_required');

  return Object.freeze({
    async verify(record) {
      const currentStateDigest = await stateObserver.observe(record.resourceDigest);
      if (currentStateDigest !== record.observedStateDigest) {
        return Object.freeze({ verified: false, reason: 'approval_state_changed' });
      }

      const decision = await capabilityBroker.authorize({
        capability: record.capability, resource: record.resourceDigest, effect: 'write',
      });
      if (decision.decision !== 'allow') {
        return Object.freeze({ verified: false, reason: 'approval_policy_changed' });
      }

      return Object.freeze({ verified: true, reason: null });
    },
  });
}
