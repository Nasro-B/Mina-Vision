// Cosine calibration seed for SFace, documented by OpenCV on the LFW benchmark at 99.60%
// accuracy: https://docs.opencv.org/4.x/d0/dd4/tutorial_dnn_face.html
// "two faces have same identity if the cosine distance is greater than or equal to 0.363".
const SFACE_LFW_COSINE_SEED_THRESHOLD = 0.363;
const REQUIRED_ANGLES = Object.freeze(['front', 'left', 'right']);
const MIN_ENROLLMENT_SAMPLES = 8;
const UNCERTAIN_BAND = 0.05;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;

function normalize(value, dimensions) {
  if (!Array.isArray(value) || value.length < dimensions || value.length > 4_096
    || value.some((item) => !Number.isFinite(item))) throw new Error('face_embedding_invalid');
  const norm = Math.sqrt(value.reduce((sum, item) => sum + item * item, 0));
  if (!Number.isFinite(norm) || norm <= 0) throw new Error('face_embedding_invalid');
  return value.map((item) => item / norm);
}

const cosine = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0);

function validateEnrollmentSamples(samples) {
  if (!Array.isArray(samples) || samples.length < MIN_ENROLLMENT_SAMPLES
    || samples.some((sample) => !Buffer.isBuffer(sample?.image) || sample.image.length < 1
      || !REQUIRED_ANGLES.includes(sample?.angle))) {
    throw new TypeError('face_enrollment_invalid');
  }
  const coveredAngles = new Set(samples.map((sample) => sample.angle));
  if (!REQUIRED_ANGLES.every((angle) => coveredAngles.has(angle))) {
    throw new TypeError('face_enrollment_angle_coverage_invalid');
  }
}

export function createFaceRecognizer({
  embedder,
  profileStore,
  confirmLocal,
  minEmbeddingDimensions = 16,
  seedThreshold = SFACE_LFW_COSINE_SEED_THRESHOLD,
  now = Date.now,
} = {}) {
  if (!embedder?.embed || !profileStore?.save || !profileStore?.list || !profileStore?.get
    || typeof confirmLocal !== 'function') {
    throw new TypeError('face_recognizer_dependencies_required');
  }

  async function enroll({ identityId, samples } = {}) {
    if (!ID.test(identityId ?? '')) throw new TypeError('face_enrollment_invalid');
    validateEnrollmentSamples(samples);

    const confirmed = await confirmLocal({
      reason: 'Créer un gabarit facial local chiffré pour la reconnaissance de présence uniquement.',
      action: { name: 'face.enroll', identityId, samples: samples.length },
    });
    if (!confirmed) throw new Error('face_enrollment_refused');

    const embeddings = [];
    for (const sample of samples) embeddings.push(normalize(await embedder.embed({ image: sample.image }), minEmbeddingDimensions));
    const dimensions = embeddings[0].length;
    if (embeddings.some((embedding) => embedding.length !== dimensions)) throw new Error('face_embedding_dimensions_mismatch');
    const average = Array.from({ length: dimensions }, (_, index) => (
      embeddings.reduce((sum, embedding) => sum + embedding[index], 0) / embeddings.length
    ));

    await profileStore.save(identityId, Object.freeze({
      version: 1,
      dimensions,
      vector: Object.freeze(normalize(average, minEmbeddingDimensions)),
      calibration: Object.freeze({
        seedThreshold,
        operationalThreshold: null,
        enrolledAtMs: now(),
        sampleCount: samples.length,
      }),
    }));
    return Object.freeze({ enrolled: true, identityId, samples: samples.length });
  }

  async function calibrate({ identityId, operationalThreshold } = {}) {
    if (!ID.test(identityId ?? '')) throw new TypeError('face_calibration_identity_invalid');
    if (!Number.isFinite(operationalThreshold) || operationalThreshold <= 0 || operationalThreshold > 1) {
      throw new TypeError('face_calibration_threshold_invalid');
    }
    const profile = await profileStore.get(identityId);
    if (!profile) throw new Error('face_profile_not_found');
    const { identityId: _drop, ...rest } = profile;
    await profileStore.save(identityId, {
      ...rest,
      calibration: { ...rest.calibration, operationalThreshold },
    });
    return Object.freeze({ identityId, operationalThreshold });
  }

  async function recognize({ image } = {}) {
    if (!Buffer.isBuffer(image) || image.length < 1) throw new TypeError('face_frame_invalid');
    const probe = normalize(await embedder.embed({ image }), minEmbeddingDimensions);
    const profiles = await profileStore.list();

    let best = null;
    for (const profile of profiles) {
      if (profile.dimensions !== probe.length) continue;
      const confidence = Math.max(-1, Math.min(1, cosine(probe, profile.vector)));
      if (!best || confidence > best.confidence) best = { identityId: profile.identityId, confidence, profile };
    }
    if (!best) return Object.freeze({ status: 'unknown', confidence: null, canAuthorize: false });

    const threshold = best.profile.calibration.operationalThreshold;
    if (threshold == null) return Object.freeze({ status: 'uncertain', confidence: null, canAuthorize: false });
    if (best.confidence >= threshold) {
      return Object.freeze({ status: 'recognized', identityId: best.identityId, confidence: best.confidence, canAuthorize: false });
    }
    if (best.confidence >= threshold - UNCERTAIN_BAND) {
      return Object.freeze({ status: 'uncertain', confidence: null, canAuthorize: false });
    }
    return Object.freeze({ status: 'unknown', confidence: null, canAuthorize: false });
  }

  return Object.freeze({ enroll, calibrate, recognize });
}
