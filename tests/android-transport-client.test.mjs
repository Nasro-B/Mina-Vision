import { describe, expect, it, vi } from 'vitest';
import { createAndroidTransportClient } from '../src/devices/android-transport-client.mjs';

const envelope = (id) => ({ id, version: 1, payloadCiphertext: 'ciphertext', signature: 'signature' });

describe('authenticated Android transport client', () => {
  it('prefers USB, fails over to LAN and deduplicates delivery', async () => {
    const usb = { endpointId: 'usb-1', type: 'usb', send: vi.fn().mockRejectedValue(new Error('usb_down')) };
    const lan = { endpointId: 'lan-1', type: 'lan', send: vi.fn(async (value) => ({ accepted: true, envelopeId: value.id })) };
    const client = createAndroidTransportClient({ verifyPeer: vi.fn(async () => true) });
    await client.connect({ endpoint: lan, proof: { deviceId: 'huawei-primary' } });
    await client.connect({ endpoint: usb, proof: { deviceId: 'huawei-primary' } });

    await expect(client.send({ queue: 'message', envelope: envelope('env-1') })).resolves.toMatchObject({ transport: 'lan' });
    await expect(client.send({ queue: 'message', envelope: envelope('env-1') })).resolves.toEqual({ duplicate: true, envelopeId: 'env-1' });
    expect(usb.send).toHaveBeenCalledOnce();
    expect(lan.send).toHaveBeenCalledOnce();
  });

  it('keeps control ahead of media, bounds queues and supports cancellation', async () => {
    let release;
    const first = new Promise((resolve) => { release = resolve; });
    const order = [];
    const usb = { endpointId: 'usb-1', type: 'usb', send: vi.fn(async (value) => {
      order.push(value.id);
      if (value.id === 'media-1') await first;
      return { accepted: true, envelopeId: value.id };
    }) };
    const client = createAndroidTransportClient({ verifyPeer: vi.fn(async () => true), capacities: { control: 2, message: 2, media: 2 } });
    await client.connect({ endpoint: usb, proof: { deviceId: 'huawei-primary' } });
    const media = client.send({ queue: 'media', envelope: envelope('media-1') });
    await Promise.resolve();
    const media2 = client.send({ queue: 'media', envelope: envelope('media-2') });
    const control = client.send({ queue: 'control', envelope: envelope('control-1') });
    release();
    await Promise.all([media, media2, control]);
    expect(order).toEqual(['media-1', 'control-1', 'media-2']);

    const aborted = new AbortController();
    aborted.abort();
    await expect(client.send({ queue: 'control', envelope: envelope('canceled'), signal: aborted.signal }))
      .rejects.toThrow('android_transport_canceled');
  });

  it('keeps USB in offline mode, allows LAN in local-only and rejects untrusted peers', async () => {
    const verifyPeer = vi.fn(async (proof) => proof.deviceId === 'huawei-primary');
    const usb = { endpointId: 'usb-1', type: 'usb', send: vi.fn(async (value) => ({ accepted: true, envelopeId: value.id })) };
    const lan = { endpointId: 'lan-1', type: 'lan', send: vi.fn(async (value) => ({ accepted: true, envelopeId: value.id })) };
    const offline = createAndroidTransportClient({ verifyPeer, mode: 'offline' });
    await offline.connect({ endpoint: usb, proof: { deviceId: 'huawei-primary' } });
    await expect(offline.connect({ endpoint: lan, proof: { deviceId: 'huawei-primary' } })).rejects.toThrow('android_transport_disabled:lan');
    await expect(offline.send({ queue: 'control', envelope: envelope('env-usb') })).resolves.toMatchObject({ transport: 'usb' });

    const localOnly = createAndroidTransportClient({ verifyPeer, mode: 'local-only' });
    await localOnly.connect({ endpoint: lan, proof: { deviceId: 'huawei-primary' } });
    await expect(localOnly.send({ queue: 'message', envelope: envelope('env-lan') })).resolves.toMatchObject({ transport: 'lan' });
    await expect(localOnly.connect({ endpoint: usb, proof: { deviceId: 'intruder' } })).rejects.toThrow('android_peer_untrusted');
  });
});
