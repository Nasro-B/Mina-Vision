import { describe, expect, it, vi } from 'vitest';
import { createWindowsHfpAudioPort } from '../src/telephony/windows-hfp-audio-port.mjs';
import { createBluetoothHfpMediaAdapter } from '../src/telephony/bluetooth-hfp-media-adapter.mjs';

// Endpoints HFP énumérés (identité = deviceId signé ; un endpoint sans deviceId = nom BT seul, instable).
const PAIRED = [
  { endpointId: 'hfp:huawei', deviceId: 'dev-huawei' },
  { endpointId: 'hfp:samsung', deviceId: 'dev-samsung' },
  { endpointId: 'hfp:instable', deviceId: null }, // seulement un nom/adresse BT : pas une identité (§6.1)
];
const enumerateEndpoints = () => PAIRED;

// Lien SCO natif SIMULÉ (le vrai binding Windows audio est la SEULE pièce à approuver + brancher).
function fakeScoLink() {
  const opened = [];
  return (endpointId) => {
    let alive = true;
    opened.push(endpointId);
    return { endpointId, close: () => { alive = false; }, healthy: () => alive, _opened: opened };
  };
}

describe('windows-hfp-audio-port (Phase 6, orchestration §6 sans binding natif)', () => {
  it('acquiert un endpoint appairé stable et ouvre le lien SCO', () => {
    const openScoLink = fakeScoLink();
    const port = createWindowsHfpAudioPort({ enumerateEndpoints, openScoLink });
    const handle = port.acquire({ endpointId: 'hfp:huawei' });
    expect(handle.endpointId).toBe('hfp:huawei');
    expect(port.probe(handle)).toBe(true);
  });

  it('refuse un endpoint non appairé (pas de fallback)', () => {
    const port = createWindowsHfpAudioPort({ enumerateEndpoints, openScoLink: fakeScoLink() });
    expect(() => port.acquire({ endpointId: 'hfp:inconnu' })).toThrow('hfp_endpoint_not_paired');
  });

  it('refuse un endpoint sans identité stable (nom BT seul, §6.1)', () => {
    const port = createWindowsHfpAudioPort({ enumerateEndpoints, openScoLink: fakeScoLink() });
    expect(() => port.acquire({ endpointId: 'hfp:instable' })).toThrow('hfp_endpoint_identity_unstable');
  });

  it('SANS binding audio natif : échec fermé HONNÊTE (jamais un faux média)', () => {
    const port = createWindowsHfpAudioPort({ enumerateEndpoints, openScoLink: null });
    expect(() => port.acquire({ endpointId: 'hfp:huawei' })).toThrow('hfp_native_binding_absent');
  });

  it('release ferme le lien ; probe reflète la perte de santé', () => {
    const port = createWindowsHfpAudioPort({ enumerateEndpoints, openScoLink: fakeScoLink() });
    const handle = port.acquire({ endpointId: 'hfp:samsung' });
    expect(port.probe(handle)).toBe(true);
    port.release(handle);
    expect(port.probe(handle)).toBe(false); // lien fermé → non sain
  });

  it('s’enfiche dans le pont média HFP : lockForCall ouvre le SCO via ce port', () => {
    const openScoLink = fakeScoLink();
    const port = createWindowsHfpAudioPort({ enumerateEndpoints, openScoLink });
    const adapter = createBluetoothHfpMediaAdapter({ audioPort: port });
    adapter.bind({ deviceId: 'dev-huawei', endpointId: 'hfp:huawei' });
    adapter.lockForCall({ callId: 'c1', deviceId: 'dev-huawei' });
    expect(adapter.checkHealth('c1')).toMatchObject({ healthy: true });
    adapter.release('c1');
    expect(adapter.activeSessions()).toBe(0);
  });
});
