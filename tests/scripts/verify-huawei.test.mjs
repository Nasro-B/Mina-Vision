import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyDeviceProof } from '../../scripts/android/verify-device-proof.mjs';

describe('Huawei verification script', () => {
  it('is read-only, redacts serials and never enables Wi-Fi debugging itself', async () => {
    const script = await readFile(new URL('../../scripts/android/verify-huawei.ps1', import.meta.url), 'utf8');
    expect(script).toContain('getprop ro.product.model');
    expect(script).toContain('getprop ro.build.version.sdk');
    expect(script).toContain('com.google.android.gms');
    expect(script).toContain('device-identity.json');
    expect(script).toContain('SHA256');
    expect(script).toContain('verify-device-proof.mjs');
    expect(script).not.toMatch(/\btcpip\s+5555\b|\badb\s+connect\b|install\s+-r/iu);
  });

  it('verifies the ES256 device proof instead of trusting a self-declared ID', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const proof = {
      deviceId: 'huawei-primary',
      publicKeySpkiBase64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      challenge: 'local-pairing-v1',
    };
    const framed = [proof.deviceId, proof.publicKeySpkiBase64, proof.challenge]
      .map((value) => `${Buffer.byteLength(value)}:${value}`).join('|');
    proof.signatureBase64 = sign('sha256', Buffer.from(framed), privateKey).toString('base64');
    expect(verifyDeviceProof(proof)).toBe(true);
    expect(verifyDeviceProof({ ...proof, deviceId: 'second-phone' })).toBe(false);
  });

  it('documents deliberate USB-to-LAN pairing and second-phone rejection', async () => {
    const runbook = await readFile(new URL('../../docs/runbooks/huawei-pairing.md', import.meta.url), 'utf8');
    expect(runbook).toContain('adb -s <SERIAL_USB> tcpip 5555');
    expect(runbook).toContain('adb connect <IP_HUAWEI>:5555');
    expect(runbook).toContain('seconde identité');
    expect(runbook).toContain('ne désactive jamais le Wi-Fi du PC');
  });
});
