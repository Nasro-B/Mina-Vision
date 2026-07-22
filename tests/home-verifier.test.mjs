import { describe, expect, it } from 'vitest';
import { createSmartHomeVerifier } from '../src/home/home-verifier.mjs';

describe('smart home verifier: never claims success without a matching state read', () => {
  it('reports failed when the connector never accepted the command', () => {
    const verifier = createSmartHomeVerifier();
    expect(verifier.verify({ accepted: false, observedState: null, desiredState: { on: true } }))
      .toEqual({ state: 'failed', verified: false });
  });

  it('reports accepted_by_provider when accepted but the observed state does not yet match', () => {
    const verifier = createSmartHomeVerifier();
    const result = verifier.verify({ accepted: true, observedState: { on: false }, desiredState: { on: true } });
    expect(result).toEqual({ state: 'accepted_by_provider', verified: false, observedState: { on: false } });
  });

  it('reports state_confirmed only once the observed state matches the desired state exactly', () => {
    const verifier = createSmartHomeVerifier();
    const result = verifier.verify({ accepted: true, observedState: { on: true }, desiredState: { on: true } });
    expect(result).toEqual({ state: 'state_confirmed', verified: true, observedState: { on: true } });
  });

  it('deep-compares object-valued desired state such as color', () => {
    const verifier = createSmartHomeVerifier();
    const result = verifier.verify({
      accepted: true, observedState: { color: { r: 255, g: 0, b: 0 } }, desiredState: { color: { r: 255, g: 0, b: 0 } },
    });
    expect(result.verified).toBe(true);
  });
});
