import { randomUUID } from 'node:crypto';
import { sealRecord, openRecord } from '../memory/record-codec.mjs';
import {
  ALLOWED_PERSONALITY_FIELDS, DEFAULT_PERSONALITY_PROFILE, validatePersonalityPatch, applyPersonalityPatch, diffProfile,
} from './personality-profile.mjs';

const RECORD_TYPE = 'personality-profile';
// One profile per Mina instance, so the AAD id only needs to separate this record type from other
// encrypted config sharing the same key — not identify a specific profile (see emergency-corpus.mjs
// for the same reasoning: the envelope itself carries no id field to recover before decrypting).
const AAD_ID = 'personality-profile-active';

function defaultState() {
  return Object.freeze({ profile: DEFAULT_PERSONALITY_PROFILE, version: 0, history: Object.freeze([]), updatedAt: null });
}

export function createPersonalityService({ keyring, configRepository, clock } = {}) {
  if (!keyring?.open) throw new TypeError('personality_service_keyring_required');
  if (!configRepository?.get || !configRepository?.put) throw new TypeError('personality_service_config_repository_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('personality_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const pendingPatches = new Map();

  async function loadState() {
    const ciphertext = await configRepository.get(AAD_ID);
    if (!ciphertext) return defaultState();
    const key = await keyring.open();
    return openRecord({ key, type: RECORD_TYPE, id: AAD_ID, ciphertext });
  }

  async function saveState(state) {
    const key = await keyring.open();
    const sealed = sealRecord({ key, type: RECORD_TYPE, id: AAD_ID, value: state });
    await configRepository.put(AAD_ID, sealed);
  }

  return Object.freeze({
    async get() {
      return (await loadState()).profile;
    },

    // Never mutates the active profile. Only stages a candidate + its diff; confirmPatch is the
    // one place that ever writes — this is the "every patch requires local confirmation" gate.
    async proposePatch(patch) {
      const validated = validatePersonalityPatch(patch);
      const state = await loadState();
      const toProfile = applyPersonalityPatch(state.profile, validated);
      const patchId = randomUUID();
      pendingPatches.set(patchId, Object.freeze({
        patchId, fromProfile: state.profile, toProfile, proposedAt: new Date(now()).toISOString(),
      }));
      return Object.freeze({
        patchId, patch: validated, diff: diffProfile(state.profile, toProfile), requiresLocalConfirmation: true,
      });
    },

    async confirmPatch(patchId) {
      const pending = pendingPatches.get(patchId);
      if (!pending) throw new Error('personality_patch_not_found');
      const state = await loadState();
      const previous = Object.freeze({ profile: state.profile, version: state.version, activatedAt: state.updatedAt });
      const nextState = Object.freeze({
        profile: pending.toProfile, version: state.version + 1,
        history: Object.freeze([...state.history, previous]), updatedAt: new Date(now()).toISOString(),
      });
      await saveState(nextState);
      pendingPatches.delete(patchId);
      return Object.freeze({ profile: nextState.profile, version: nextState.version });
    },

    // One atomic state write back to the active pointer — mirrors connector-version-service.rollback.
    async rollback() {
      const state = await loadState();
      if (state.history.length === 0) throw new Error('personality_no_previous_version');
      const previous = state.history[state.history.length - 1];
      const nextState = Object.freeze({
        profile: previous.profile, version: previous.version,
        history: Object.freeze(state.history.slice(0, -1)), updatedAt: new Date(now()).toISOString(),
      });
      await saveState(nextState);
      return Object.freeze({ profile: nextState.profile, version: nextState.version });
    },

    // Renders ONLY style fields for a channel — never version/history/repository internals, and
    // never anything from outside ALLOWED_PERSONALITY_FIELDS (so memoryPolicy, safety flags, etc.
    // can never leak into what a renderer receives, structurally, not by convention).
    async renderStyleContext(channel) {
      const state = await loadState();
      const override = state.profile.channelOverrides?.[channel] ?? {};
      const merged = { ...state.profile, ...override };
      const context = {};
      for (const field of ALLOWED_PERSONALITY_FIELDS) {
        if (field === 'channelOverrides') continue;
        context[field] = merged[field];
      }
      return Object.freeze(context);
    },
  });
}
