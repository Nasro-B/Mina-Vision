import { createPublicKey, verify } from 'node:crypto';

function framed(values) {
  return Buffer.from(values.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('|'), 'utf8');
}

export function verifyDeviceProof(proof) {
  try {
    if (!proof || !/^[A-Za-z0-9._:-]{1,160}$/u.test(proof.deviceId ?? '')
      || typeof proof.publicKeySpkiBase64 !== 'string' || typeof proof.challenge !== 'string'
      || typeof proof.signatureBase64 !== 'string') return false;
    const key = createPublicKey({
      key: Buffer.from(proof.publicKeySpkiBase64, 'base64'), format: 'der', type: 'spki',
    });
    return verify('sha256', framed([proof.deviceId, proof.publicKeySpkiBase64, proof.challenge]), key, Buffer.from(proof.signatureBase64, 'base64'));
  } catch {
    return false;
  }
}
