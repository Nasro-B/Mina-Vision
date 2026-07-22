import { describe, expect, it, vi } from 'vitest';
import { createFaceRecognizer } from '../src/biometrics/face-recognizer.mjs';
import { createFaceProfileStore } from '../src/biometrics/face-profile-store.mjs';

function fakeKeyring() {
  const secrets = new Map();
  return {
    setSecret: vi.fn(async (name, value) => { secrets.set(name, value); }),
    getSecret: vi.fn(async (name) => (secrets.has(name) ? secrets.get(name) : null)),
    deleteSecret: vi.fn(async (name) => secrets.delete(name)),
  };
}

function eightAngledSamples(vectorSeed = [1, 0, 0]) {
  const angles = ['front', 'front', 'front', 'left', 'left', 'left', 'right', 'right'];
  return angles.map((angle, index) => ({ image: Buffer.from([index + 1]), angle, embedding: vectorSeed }));
}

function recognizerWithStore({ threshold } = {}) {
  const profileStore = createFaceProfileStore({ keyring: fakeKeyring() });
  const embedder = { embed: vi.fn(async ({ image }) => image.__embedding ?? [1, 0, 0]) };
  const recognizer = createFaceRecognizer({
    embedder, profileStore, confirmLocal: vi.fn(async () => true), minEmbeddingDimensions: 3,
  });
  return { profileStore, embedder, recognizer, threshold };
}

describe('face enrollment with local consent and angle coverage', () => {
  it('stores only a normalized template under the profile store key domain, never raw images', async () => {
    const { profileStore, recognizer } = recognizerWithStore();
    await recognizer.enroll({ identityId: 'nasro', samples: eightAngledSamples() });

    const profile = await profileStore.get('nasro');
    expect(profile).toMatchObject({ dimensions: 3, calibration: { sampleCount: 8, operationalThreshold: null } });
    expect(profile.calibration.seedThreshold).toBeCloseTo(0.363);
    expect(JSON.stringify(profile)).not.toMatch(/image|raw/i);
  });

  it('refuses enrollment when local consent is declined', async () => {
    const profileStore = createFaceProfileStore({ keyring: fakeKeyring() });
    const recognizer = createFaceRecognizer({
      embedder: { embed: vi.fn(async () => [1, 0, 0]) },
      profileStore,
      confirmLocal: vi.fn(async () => false),
      minEmbeddingDimensions: 3,
    });
    await expect(recognizer.enroll({ identityId: 'nasro', samples: eightAngledSamples() }))
      .rejects.toThrow('face_enrollment_refused');
    await expect(profileStore.get('nasro')).resolves.toBeNull();
  });

  it('rejects enrollment with fewer than eight samples', async () => {
    const { recognizer } = recognizerWithStore();
    await expect(recognizer.enroll({ identityId: 'nasro', samples: eightAngledSamples().slice(0, 7) }))
      .rejects.toThrow('face_enrollment_invalid');
  });

  it('rejects enrollment missing coverage of one of the three required angles', async () => {
    const { recognizer } = recognizerWithStore();
    const frontOnly = Array.from({ length: 8 }, (_, index) => ({ image: Buffer.from([index + 1]), angle: 'front' }));
    await expect(recognizer.enroll({ identityId: 'nasro', samples: frontOnly }))
      .rejects.toThrow('face_enrollment_angle_coverage_invalid');
  });
});

describe('face recognition status: recognized, unknown, uncertain', () => {
  it('always returns uncertain when no operational threshold has been calibrated yet, regardless of score', async () => {
    const { profileStore, recognizer } = recognizerWithStore();
    await recognizer.enroll({ identityId: 'nasro', samples: eightAngledSamples([1, 0, 0]) });
    expect((await profileStore.get('nasro')).calibration.operationalThreshold).toBeNull();

    const result = await recognizer.recognize({ image: Object.assign(Buffer.from([9]), { __embedding: [1, 0, 0] }) });
    expect(result).toEqual({ status: 'uncertain', confidence: null, canAuthorize: false });
  });

  it('returns recognized with confidence once calibrated and the probe clears the operational threshold', async () => {
    const { recognizer } = recognizerWithStore();
    await recognizer.enroll({ identityId: 'nasro', samples: eightAngledSamples([1, 0, 0]) });
    await recognizer.calibrate({ identityId: 'nasro', operationalThreshold: 0.5 });

    const result = await recognizer.recognize({ image: Object.assign(Buffer.from([9]), { __embedding: [1, 0, 0] }) });
    expect(result).toEqual({ status: 'recognized', identityId: 'nasro', confidence: 1, canAuthorize: false });
  });

  it('returns unknown for a face far from every enrolled template', async () => {
    const { recognizer } = recognizerWithStore();
    await recognizer.enroll({ identityId: 'nasro', samples: eightAngledSamples([1, 0, 0]) });
    await recognizer.calibrate({ identityId: 'nasro', operationalThreshold: 0.5 });

    const result = await recognizer.recognize({ image: Object.assign(Buffer.from([9]), { __embedding: [0, 1, 0] }) });
    expect(result).toEqual({ status: 'unknown', confidence: null, canAuthorize: false });
  });

  it('returns uncertain, not a false accept or false reject, for a borderline score near the threshold', async () => {
    const { recognizer } = recognizerWithStore();
    await recognizer.enroll({ identityId: 'nasro', samples: eightAngledSamples([1, 0, 0]) });
    await recognizer.calibrate({ identityId: 'nasro', operationalThreshold: 0.5 });

    const borderline = Math.cos(Math.acos(0.5) + 0.01);
    const probeVector = [borderline, Math.sqrt(1 - borderline ** 2), 0];
    const result = await recognizer.recognize({ image: Object.assign(Buffer.from([9]), { __embedding: probeVector }) });
    expect(result.status).toBe('uncertain');
    expect(result.confidence).toBeNull();
  });

  it('never grants authorization from a recognition result alone', async () => {
    const { recognizer } = recognizerWithStore();
    await recognizer.enroll({ identityId: 'nasro', samples: eightAngledSamples([1, 0, 0]) });
    await recognizer.calibrate({ identityId: 'nasro', operationalThreshold: 0.5 });
    const result = await recognizer.recognize({ image: Object.assign(Buffer.from([9]), { __embedding: [1, 0, 0] }) });
    expect(result.canAuthorize).toBe(false);
  });

  it('returns unknown after the enrolled profile has been deleted', async () => {
    const { profileStore, recognizer } = recognizerWithStore();
    await recognizer.enroll({ identityId: 'nasro', samples: eightAngledSamples([1, 0, 0]) });
    await recognizer.calibrate({ identityId: 'nasro', operationalThreshold: 0.5 });
    await profileStore.delete('nasro');

    const result = await recognizer.recognize({ image: Object.assign(Buffer.from([9]), { __embedding: [1, 0, 0] }) });
    expect(result).toEqual({ status: 'unknown', confidence: null, canAuthorize: false });
  });
});
