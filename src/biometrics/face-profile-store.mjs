const IDENTITY_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const INDEX_NAME = 'biometric/face-profile/_index';
const PROFILE_FIELDS = ['calibration', 'dimensions', 'vector', 'version'].join(',');

function profileName(identityId) {
  return `biometric/face-profile/${identityId}`;
}

function validateIdentityId(identityId) {
  if (!IDENTITY_ID.test(identityId ?? '')) throw new TypeError('face_profile_identity_invalid');
}

function validateProfileShape(profile) {
  if (!profile || Object.keys(profile).sort().join(',') !== PROFILE_FIELDS
    || profile.version !== 1
    || !Number.isInteger(profile.dimensions) || profile.dimensions < 3
    || !Array.isArray(profile.vector) || profile.vector.length !== profile.dimensions
    || profile.vector.some((component) => !Number.isFinite(component))
    || !profile.calibration || typeof profile.calibration !== 'object') {
    throw new TypeError('face_profile_shape_invalid');
  }
}

async function readIndex(keyring) {
  const raw = await keyring.getSecret(INDEX_NAME);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeIndex(keyring, identityIds) {
  await keyring.setSecret(INDEX_NAME, JSON.stringify([...new Set(identityIds)].sort()));
}

export function createFaceProfileStore({ keyring } = {}) {
  if (!keyring?.setSecret || !keyring?.getSecret || !keyring?.deleteSecret) {
    throw new TypeError('face_profile_store_keyring_required');
  }

  return Object.freeze({
    async save(identityId, profile) {
      validateIdentityId(identityId);
      validateProfileShape(profile);
      await keyring.setSecret(profileName(identityId), JSON.stringify(profile));
      const index = await readIndex(keyring);
      if (!index.includes(identityId)) await writeIndex(keyring, [...index, identityId]);
      return Object.freeze({ identityId, saved: true });
    },

    async get(identityId) {
      validateIdentityId(identityId);
      const raw = await keyring.getSecret(profileName(identityId));
      if (!raw) return null;
      return Object.freeze({ identityId, ...JSON.parse(raw) });
    },

    async list() {
      const index = await readIndex(keyring);
      const profiles = await Promise.all(index.map(async (identityId) => {
        const raw = await keyring.getSecret(profileName(identityId));
        return raw ? Object.freeze({ identityId, ...JSON.parse(raw) }) : null;
      }));
      return Object.freeze(profiles.filter(Boolean));
    },

    async delete(identityId) {
      validateIdentityId(identityId);
      const removed = await keyring.deleteSecret(profileName(identityId));
      const index = await readIndex(keyring);
      if (index.includes(identityId)) await writeIndex(keyring, index.filter((entry) => entry !== identityId));
      return Boolean(removed);
    },
  });
}
