import { describe, expect, it, vi } from 'vitest';
import { createApprovalVerifier } from '../src/approvals/approval-verifier.mjs';

const record = Object.freeze({
  capability: 'home.execute', resourceDigest: 'sha256:aaaa', observedStateDigest: 'sha256:state1',
});

describe('createApprovalVerifier: constructor guards', () => {
  it('requires a stateObserver', () => {
    expect(() => createApprovalVerifier({ capabilityBroker: { authorize: vi.fn() } })).toThrow('approval_verifier_state_observer_required');
  });

  it('requires a capabilityBroker', () => {
    expect(() => createApprovalVerifier({ stateObserver: { observe: vi.fn() } })).toThrow('approval_verifier_capability_broker_required');
  });
});

describe('createApprovalVerifier.verify: re-observes state and re-runs policy before consumption', () => {
  it('verifies when the observed state is unchanged and the broker still allows', async () => {
    const stateObserver = { observe: vi.fn(async () => 'sha256:state1') };
    const capabilityBroker = { authorize: vi.fn(async () => ({ decision: 'allow', reason: 'ok' })) };
    const verifier = createApprovalVerifier({ stateObserver, capabilityBroker });
    expect(await verifier.verify(record)).toEqual({ verified: true, reason: null });
  });

  it('rejects when the resource state has changed since approval', async () => {
    const stateObserver = { observe: vi.fn(async () => 'sha256:state2-different') };
    const capabilityBroker = { authorize: vi.fn(async () => ({ decision: 'allow', reason: 'ok' })) };
    const verifier = createApprovalVerifier({ stateObserver, capabilityBroker });
    expect(await verifier.verify(record)).toEqual({ verified: false, reason: 'approval_state_changed' });
    expect(capabilityBroker.authorize).not.toHaveBeenCalled();
  });

  it('rejects when the capability broker no longer allows the action', async () => {
    const stateObserver = { observe: vi.fn(async () => 'sha256:state1') };
    const capabilityBroker = { authorize: vi.fn(async () => ({ decision: 'deny', reason: 'session_grant' })) };
    const verifier = createApprovalVerifier({ stateObserver, capabilityBroker });
    expect(await verifier.verify(record)).toEqual({ verified: false, reason: 'approval_policy_changed' });
  });

  it('checks state before policy (fail fast on the cheaper, more decisive check)', async () => {
    const stateObserver = { observe: vi.fn(async () => 'sha256:different') };
    const capabilityBroker = { authorize: vi.fn(async () => ({ decision: 'allow', reason: 'ok' })) };
    const verifier = createApprovalVerifier({ stateObserver, capabilityBroker });
    await verifier.verify(record);
    expect(capabilityBroker.authorize).not.toHaveBeenCalled();
  });
});
