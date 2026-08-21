import { describe, expect, it, vi } from 'vitest';
import { createBluetoothHfpMediaAdapter } from '../src/telephony/bluetooth-hfp-media-adapter.mjs';

// Port audio matériel INJECTÉ (le vrai I/O HFP Windows est branché en aval, prouvé par la porte live
// §6). acquire renvoie une poignée ou lève ; probe rend une santé configurable ; release libère.
function fakeAudioPort({ failEndpoints = new Set(), health = () => true } = {}) {
  const acquired = new Map();
  return {
    calls: { acquire: [], release: [] },
    acquire({ endpointId }) {
      this.calls.acquire.push(endpointId);
      if (failEndpoints.has(endpointId)) throw new Error('hardware_endpoint_down');
      const handle = { endpointId };
      acquired.set(endpointId, handle);
      return handle;
    },
    probe(handle) { return health(handle.endpointId); },
    release(handle) { this.calls.release.push(handle.endpointId); acquired.delete(handle.endpointId); },
  };
}

const A = { deviceId: 'dev-huawei', endpointId: 'hfp:huawei' };
const B = { deviceId: 'dev-samsung', endpointId: 'hfp:samsung' };

describe('bluetooth-hfp-media-adapter (Phase 6)', () => {
  it('verrouille l’endpoint d’un appareil pour un appel et l’acquiert', () => {
    const audioPort = fakeAudioPort();
    const adapter = createBluetoothHfpMediaAdapter({ audioPort });
    adapter.bind(A);
    const session = adapter.lockForCall({ callId: 'c1', deviceId: A.deviceId });
    expect(session.endpointId).toBe(A.endpointId);
    expect(audioPort.calls.acquire).toEqual(['hfp:huawei']);
    expect(adapter.activeSessions()).toBe(1);
  });

  it('isolation 2 téléphones : router un appareil n’injecte jamais dans l’autre appel (§6.1)', () => {
    const audioPort = fakeAudioPort();
    const adapter = createBluetoothHfpMediaAdapter({ audioPort });
    adapter.bind(A); adapter.bind(B);
    adapter.lockForCall({ callId: 'c1', deviceId: A.deviceId });
    adapter.lockForCall({ callId: 'c2', deviceId: B.deviceId });
    expect(adapter.activeSessions()).toBe(2);
    adapter.release('c1');
    expect(adapter.activeSessions()).toBe(1); // l'appel B continue, intact
    expect(adapter.isLocked(A.endpointId)).toBe(false);
    expect(adapter.isLocked(B.endpointId)).toBe(true);
  });

  it('un seul endpoint par appel : verrouiller un endpoint déjà pris est refusé (jamais de cross-inject)', () => {
    const audioPort = fakeAudioPort();
    const adapter = createBluetoothHfpMediaAdapter({ audioPort });
    adapter.bind(A);
    adapter.lockForCall({ callId: 'c1', deviceId: A.deviceId });
    expect(() => adapter.lockForCall({ callId: 'c2', deviceId: A.deviceId })).toThrow('hfp_endpoint_busy');
  });

  it('INTERDIT le fallback audio général : endpoint indisponible → fail-closed, jamais le micro ambiant (§6.1)', () => {
    const audioPort = fakeAudioPort({ failEndpoints: new Set(['hfp:huawei']) });
    const adapter = createBluetoothHfpMediaAdapter({ audioPort });
    adapter.bind(A);
    expect(() => adapter.lockForCall({ callId: 'c1', deviceId: A.deviceId })).toThrow('hfp_endpoint_unavailable');
    expect(adapter.activeSessions()).toBe(0); // aucune session dégradée ouverte
  });

  it('verrouiller un appareil non appairé HFP échoue fermé (pas de fallback)', () => {
    const audioPort = fakeAudioPort();
    const adapter = createBluetoothHfpMediaAdapter({ audioPort });
    expect(() => adapter.lockForCall({ callId: 'c1', deviceId: 'dev-inconnu' })).toThrow('hfp_endpoint_unbound');
    expect(audioPort.calls.acquire).toEqual([]); // jamais tenté d'ouvrir quoi que ce soit
  });

  it('santé perdue pendant l’appel → signale l’arrêt (jamais un appel silencieux, §7)', () => {
    let healthy = true;
    const audioPort = fakeAudioPort({ health: () => healthy });
    const adapter = createBluetoothHfpMediaAdapter({ audioPort });
    adapter.bind(A);
    adapter.lockForCall({ callId: 'c1', deviceId: A.deviceId });
    expect(adapter.checkHealth('c1')).toMatchObject({ healthy: true });
    healthy = false;
    expect(adapter.checkHealth('c1')).toMatchObject({ healthy: false, mustStop: true });
  });

  it('identité par deviceId : reconnexion même deviceId OK ; même endpoint sous un autre deviceId REFUSÉ (§6.1)', () => {
    const audioPort = fakeAudioPort();
    const adapter = createBluetoothHfpMediaAdapter({ audioPort });
    adapter.bind(A);
    adapter.bind(A); // reconnexion : même deviceId + même endpoint, idempotent
    expect(() => adapter.bind({ deviceId: 'usurpateur', endpointId: A.endpointId }))
      .toThrow('hfp_endpoint_identity_conflict'); // un nom BT/IP ne prend pas l'identité
  });

  it('release libère l’endpoint et le port audio ; on peut re-verrouiller ensuite', () => {
    const audioPort = fakeAudioPort();
    const adapter = createBluetoothHfpMediaAdapter({ audioPort });
    adapter.bind(A);
    adapter.lockForCall({ callId: 'c1', deviceId: A.deviceId });
    adapter.release('c1');
    expect(audioPort.calls.release).toEqual(['hfp:huawei']);
    expect(() => adapter.lockForCall({ callId: 'c2', deviceId: A.deviceId })).not.toThrow();
  });
});
