import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deriveDeviceWrapKey, unwrapEpochKey, wrapEpochKey } from '../src/devices/chat-crypto.mjs';

const vectors = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/protocol/mina-chat-device-wrap-vectors.json', import.meta.url)),
  'utf8',
));

const priv = (hex) => createPrivateKey({ key: Buffer.from(hex, 'hex'), format: 'der', type: 'pkcs8' });
const pub = (hex) => createPublicKey({ key: Buffer.from(hex, 'hex'), format: 'der', type: 'spki' });

describe('clé d\'enveloppement dérivée par ECDH', () => {
  it('les deux côtés obtiennent la MÊME clé sans qu\'aucun secret ne transite', () => {
    const fromPc = deriveDeviceWrapKey({
      privateKey: priv(vectors.pcPrivatePkcs8Hex),
      peerPublicKey: pub(vectors.devicePublicSpkiHex),
      deviceId: vectors.deviceId,
    });
    const fromDevice = deriveDeviceWrapKey({
      privateKey: priv(vectors.devicePrivatePkcs8Hex),
      peerPublicKey: pub(vectors.pcPublicSpkiHex),
      deviceId: vectors.deviceId,
    });
    expect(fromPc.toString('hex')).toBe(fromDevice.toString('hex'));
    // Vecteur figé : Kotlin lit le MÊME fichier, donc une divergence casserait ici aussi.
    expect(fromPc.toString('hex')).toBe(vectors.expectedWrapKeyHex);
  });

  it('un autre appareil obtient une clé différente — le sel est l\'identifiant', () => {
    const derive = (deviceId) => deriveDeviceWrapKey({
      privateKey: priv(vectors.pcPrivatePkcs8Hex),
      peerPublicKey: pub(vectors.devicePublicSpkiHex),
      deviceId,
    }).toString('hex');
    expect(derive('device-huawei')).not.toBe(derive('device-samsung'));
  });

  it('une clé étrangère ne permet pas de retrouver la clé d\'enveloppement', () => {
    const intruder = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
      publicKeyEncoding: { type: 'spki', format: 'der' },
    });
    const legitimate = deriveDeviceWrapKey({
      privateKey: priv(vectors.pcPrivatePkcs8Hex),
      peerPublicKey: pub(vectors.devicePublicSpkiHex),
      deviceId: vectors.deviceId,
    });
    const forged = deriveDeviceWrapKey({
      privateKey: priv(vectors.pcPrivatePkcs8Hex),
      peerPublicKey: createPublicKey({ key: intruder.publicKey, format: 'der', type: 'spki' }),
      deviceId: vectors.deviceId,
    });
    expect(forged.equals(legitimate)).toBe(false);
  });

  it('la clé dérivée transporte réellement une clé d\'époque de bout en bout', () => {
    const epochKey = randomBytes(32);
    const pcSide = deriveDeviceWrapKey({
      privateKey: priv(vectors.pcPrivatePkcs8Hex),
      peerPublicKey: pub(vectors.devicePublicSpkiHex),
      deviceId: vectors.deviceId,
    });
    const wrapped = wrapEpochKey({
      deviceWrapKey: pcSide,
      epochKey: Buffer.from(epochKey),
      deviceId: vectors.deviceId,
      keyEpoch: 1,
    });

    const deviceSide = deriveDeviceWrapKey({
      privateKey: priv(vectors.devicePrivatePkcs8Hex),
      peerPublicKey: pub(vectors.pcPublicSpkiHex),
      deviceId: vectors.deviceId,
    });
    const opened = unwrapEpochKey({
      deviceWrapKey: deviceSide,
      wrapped,
      deviceId: vectors.deviceId,
      keyEpoch: 1,
    });
    expect(opened.equals(epochKey)).toBe(true);
  });

  it('refuse une dérivation sans identifiant d\'appareil', () => {
    expect(() => deriveDeviceWrapKey({
      privateKey: priv(vectors.pcPrivatePkcs8Hex),
      peerPublicKey: pub(vectors.devicePublicSpkiHex),
      deviceId: '',
    })).toThrow('device_wrap_device_id_manquant');
  });
});
