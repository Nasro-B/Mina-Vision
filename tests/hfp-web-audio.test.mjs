import { describe, expect, it, vi } from 'vitest';
import { enumerateHfpAudioEndpoints, openHfpScoLink } from '../src/telephony/hfp-web-audio.mjs';

// Web Audio SIMULÉ (mêmes APIs que la stack voix : mediaDevices + AudioContext). Aucune dép native.
function fakeMediaDevices(devices, { stream } = {}) {
  return {
    enumerateDevices: async () => devices,
    getUserMedia: vi.fn(async () => stream ?? { getAudioTracks: () => [{ readyState: 'live', stop: vi.fn() }] }),
  };
}
const HFP_IN = { kind: 'audioinput', deviceId: 'in-1', groupId: 'g-huawei', label: 'Casque mains libres (Huawei)' };
const HFP_OUT = { kind: 'audiooutput', deviceId: 'out-1', groupId: 'g-huawei', label: 'Casque mains libres (Huawei)' };
const MIC_ONLY = { kind: 'audioinput', deviceId: 'in-mic', groupId: 'g-usbmic', label: 'Micro USB' }; // pas de sortie → pas HFP

describe('hfp-web-audio (I/O audio HFP via Web Audio renderer, sans dép native)', () => {
  it('énumère les endpoints HFP en appairant micro+sortie par groupId', async () => {
    const md = fakeMediaDevices([HFP_IN, HFP_OUT, MIC_ONLY]);
    const endpoints = await enumerateHfpAudioEndpoints(md);
    expect(endpoints).toHaveLength(1); // le micro USB (sans sortie appairée) n'est pas un endpoint d'appel
    expect(endpoints[0]).toMatchObject({ endpointId: 'g-huawei', inputDeviceId: 'in-1', outputDeviceId: 'out-1' });
  });

  it('ouvre un lien SCO : capture RX (getUserMedia) + contexte TX, sain tant que la piste vit', async () => {
    const track = { readyState: 'live', stop: vi.fn() };
    const md = fakeMediaDevices([HFP_IN, HFP_OUT], { stream: { getAudioTracks: () => [track] } });
    const ctxClose = vi.fn();
    const createAudioContext = () => ({ close: ctxClose });
    const link = await openHfpScoLink({ mediaDevices: md, createAudioContext }, { inputDeviceId: 'in-1', outputDeviceId: 'out-1' });
    expect(md.getUserMedia).toHaveBeenCalledWith({ audio: expect.objectContaining({ deviceId: { exact: 'in-1' } }) });
    expect(link.healthy()).toBe(true);
    link.close();
    expect(track.stop).toHaveBeenCalled();
    expect(ctxClose).toHaveBeenCalled();
    expect(link.healthy()).toBe(false);
  });

  it('refuse d’ouvrir sans device d’entrée', async () => {
    const md = fakeMediaDevices([]);
    await expect(openHfpScoLink({ mediaDevices: md, createAudioContext: () => ({}) }, {})).rejects.toThrow('hfp_sco_input_required');
  });

  it('santé fausse quand la piste s’est terminée (perte média)', async () => {
    const track = { readyState: 'ended', stop: vi.fn() };
    const md = fakeMediaDevices([HFP_IN, HFP_OUT], { stream: { getAudioTracks: () => [track] } });
    const link = await openHfpScoLink({ mediaDevices: md, createAudioContext: () => ({ close() {} }) }, { inputDeviceId: 'in-1' });
    expect(link.healthy()).toBe(false);
  });
});
