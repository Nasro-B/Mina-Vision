import { describe, expect, it, vi } from 'vitest';
import { createFaceProfileStore } from '../src/biometrics/face-profile-store.mjs';

function fakeKeyring() {
  const secrets = new Map();
  return {
    secrets,
    setSecret: vi.fn(async (name, value) => { secrets.set(name, value); }),
    getSecret: vi.fn(async (name) => (secrets.has(name) ? secrets.get(name) : null)),
    hasSecret: vi.fn(async (name) => secrets.has(name)),
    deleteSecret: vi.fn(async (name) => secrets.delete(name)),
  };
}

const PROFILE = Object.freeze({
  version: 1,
  dimensions: 3,
  vector: Object.freeze([1, 0, 0]),
  calibration: Object.freeze({ seedThreshold: 0.363, operationalThreshold: null, enrolledAtMs: 1_000, sampleCount: 8 }),
});

describe('encrypted face profile store', () => {
  it('stores a profile under the biometric/face-profile key domain, never a raw image field', async () => {
    const keyring = fakeKeyring();
    const store = createFaceProfileStore({ keyring });

    await store.save('nasro', PROFILE);

    expect(keyring.setSecret).toHaveBeenCalledWith('biometric/face-profile/nasro', expect.any(String));
    const stored = JSON.parse(keyring.secrets.get('biometric/face-profile/nasro'));
    expect(stored).toMatchObject({ dimensions: 3, vector: [1, 0, 0] });
    expect(stored).not.toHaveProperty('image');
    expect(stored).not.toHaveProperty('rawImage');
    expect(stored).not.toHaveProperty('images');
  });

  it('rejects an identity id outside the safe secret-name charset', async () => {
    const store = createFaceProfileStore({ keyring: fakeKeyring() });
    await expect(store.save('Nasro Berkoun', PROFILE)).rejects.toThrow('face_profile_identity_invalid');
  });

  it('rejects a profile containing raw image bytes instead of a vector', async () => {
    const store = createFaceProfileStore({ keyring: fakeKeyring() });
    await expect(store.save('nasro', { ...PROFILE, image: Buffer.from('x') })).rejects.toThrow('face_profile_shape_invalid');
  });

  it('returns null for an identity that was never enrolled', async () => {
    const store = createFaceProfileStore({ keyring: fakeKeyring() });
    await expect(store.get('unknown-person')).resolves.toBeNull();
  });

  it('lists every enrolled profile after multiple saves', async () => {
    const store = createFaceProfileStore({ keyring: fakeKeyring() });
    await store.save('nasro', PROFILE);
    await store.save('guest-1', { ...PROFILE, vector: [0, 1, 0] });

    const all = await store.list();
    expect(all.map((profile) => profile.identityId).sort()).toEqual(['guest-1', 'nasro']);
  });

  it('removes a deleted profile from both storage and the enrolled index', async () => {
    const keyring = fakeKeyring();
    const store = createFaceProfileStore({ keyring });
    await store.save('nasro', PROFILE);

    const deleted = await store.delete('nasro');

    expect(deleted).toBe(true);
    await expect(store.get('nasro')).resolves.toBeNull();
    expect(await store.list()).toEqual([]);
    expect(keyring.secrets.has('biometric/face-profile/nasro')).toBe(false);
  });

  it('deleting an identity that does not exist returns false without error', async () => {
    const store = createFaceProfileStore({ keyring: fakeKeyring() });
    await expect(store.delete('ghost')).resolves.toBe(false);
  });
});
