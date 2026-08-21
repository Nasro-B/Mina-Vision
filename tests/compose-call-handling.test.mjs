import { describe, expect, it } from 'vitest';
import { createCallHandler } from '../src/telephony/compose-call-handling.mjs';
import * as incomingPolicy from '../src/telephony/incoming-call-policy.mjs';
import { createCallDisclosure } from '../src/telephony/call-disclosure.mjs';
import { createBluetoothHfpMediaAdapter } from '../src/telephony/bluetooth-hfp-media-adapter.mjs';
import { createCallSession } from '../src/telephony/call-session-manager.mjs';
import { createCommunicationLedger } from '../src/communications/communication-ledger.mjs';

const readyState = () => incomingPolicy.evaluateReadiness(
  incomingPolicy.READINESS_CONDITIONS.reduce((acc, c) => ({ ...acc, [c]: true }), {}),
);
function workingHfp() {
  const port = { acquire: ({ endpointId }) => ({ endpointId, close() {}, healthy: () => true }), release() {}, probe: () => true };
  const adapter = createBluetoothHfpMediaAdapter({ audioPort: port });
  adapter.bind({ deviceId: 'dev-A', endpointId: 'hfp:A' });
  return adapter;
}
function deadHfp() { // port sans matériel : acquire échoue → média indisponible
  const adapter = createBluetoothHfpMediaAdapter({ audioPort: { acquire() { throw new Error('hfp_no_hardware'); }, release() {}, probe: () => false } });
  adapter.bind({ deviceId: 'dev-A', endpointId: 'hfp:A' });
  return adapter;
}
function build({ legallyValidated = true, hfpAdapter = workingHfp() } = {}) {
  const ledger = createCommunicationLedger({ filename: ':memory:', now: () => 1000 });
  const handler = createCallHandler({
    incomingPolicy,
    disclosure: createCallDisclosure({ legallyValidated }),
    hfpAdapter,
    ledger,
    createSession: createCallSession,
  });
  return { handler, ledger };
}
const callEvent = (over = {}) => ({ callId: 'call-1', deviceId: 'dev-A', numberE164: '+33612345678', atMs: 1000, dedupeKey: 'dk1', ...over });

describe('compose-call-handling (orchestration des gates §7/§8/§17)', () => {
  it('niveau observation : n’agit jamais', () => {
    const { handler } = build();
    expect(handler.handleIncoming({ callEvent: callEvent(), readiness: readyState(), level: 'observe' }))
      .toMatchObject({ action: 'observe', reason: 'observation_only' });
  });

  it('éligible mais RGPD non validé → observation (gate §17)', () => {
    const { handler } = build({ legallyValidated: false });
    expect(handler.handleIncoming({ callEvent: callEvent(), readiness: readyState(), level: 'assisted' }))
      .toMatchObject({ action: 'observe', reason: 'rgpd_not_validated' });
  });

  it('éligible + RGPD validé mais média indisponible → observation (jamais un appel muet)', () => {
    const { handler } = build({ hfpAdapter: deadHfp() });
    const result = handler.handleIncoming({ callEvent: callEvent(), readiness: readyState(), level: 'assisted' });
    expect(result.action).toBe('observe');
    expect(result.reason).toMatch(/^media_unavailable/u);
  });

  it('un appel déjà actif → observation (concurrence §11)', () => {
    const { handler } = build();
    expect(handler.handleIncoming({ callEvent: callEvent(), readiness: readyState(), level: 'assisted', activeMinaCalls: 1 }))
      .toMatchObject({ action: 'observe', reason: 'concurrent_call' });
  });

  it('tous les gates passent → répondre, avec message d’info et session ouverte au ledger', () => {
    const { handler, ledger } = build();
    const result = handler.handleIncoming({ callEvent: callEvent(), readiness: readyState(), level: 'assisted' });
    expect(result.action).toBe('answer');
    expect(result.disclosureText).toMatch(/Mina/u);
    expect(ledger.getCallSession('call-1')).toMatchObject({ deviceId: 'dev-A', media: 'hfp:A' });
  });
});
