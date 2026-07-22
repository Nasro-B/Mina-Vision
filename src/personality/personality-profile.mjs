import { z } from 'zod';

// The full allowlist the whole module is built around: anything outside this list is rejected
// with `personality_field_forbidden` before it ever reaches Zod. There is deliberately no field
// here for activation phrases, safety, facts, or capabilities — personality can only ever touch
// how Mina sounds, never what Mina is allowed to do or say is true.
export const ALLOWED_PERSONALITY_FIELDS = Object.freeze([
  'displayName', 'language', 'tone', 'detailLevel', 'proactiveSuggestions',
  'humorLevel', 'preferredVocabulary', 'dislikedPhrases', 'channelOverrides',
]);

export const DEFAULT_PERSONALITY_PROFILE = Object.freeze({
  displayName: 'Mina', language: 'fr', tone: 'neutral', detailLevel: 'normal',
  proactiveSuggestions: true, humorLevel: 'light', preferredVocabulary: Object.freeze([]),
  dislikedPhrases: Object.freeze([]), channelOverrides: Object.freeze({}),
});

// Bounded (enum/length-capped) rather than open free-text, so a confirmed patch can only move the
// profile within a known-safe style space — never inject arbitrary steering text into rendering.
const styleFieldShapes = {
  displayName: z.string().min(1).max(60),
  language: z.string().min(2).max(10),
  tone: z.enum(['neutral', 'warm', 'formal', 'playful']),
  detailLevel: z.enum(['concise', 'normal', 'detailed']),
  proactiveSuggestions: z.boolean(),
  humorLevel: z.enum(['none', 'light', 'more']),
  preferredVocabulary: z.array(z.string().min(1).max(80)).max(50),
  dislikedPhrases: z.array(z.string().min(1).max(200)).max(50),
};

const channelOverrideSchema = z.strictObject(
  Object.fromEntries(Object.entries(styleFieldShapes).map(([field, shape]) => [field, shape.optional()])),
);

const profileSchema = z.strictObject({
  ...Object.fromEntries(Object.entries(styleFieldShapes).map(([field, shape]) => [field, shape.default(DEFAULT_PERSONALITY_PROFILE[field])])),
  channelOverrides: z.record(z.string().min(1).max(80), channelOverrideSchema).default({}),
});

const patchSchema = z.strictObject({
  ...Object.fromEntries(Object.entries(styleFieldShapes).map(([field, shape]) => [field, shape.optional()])),
  channelOverrides: z.record(z.string().min(1).max(80), channelOverrideSchema).optional(),
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function validateProfile(input) {
  return deepFreeze(profileSchema.parse(input));
}

// Manual allowlist check runs before Zod parsing so an out-of-scope field (e.g. `allowedCapabilities`,
// `safety`, anything MINA.md-level) always fails with this exact, matchable error — not Zod's generic
// unrecognized_keys message (same lesson as connector-manifest.mjs's secretDeclarationSchema).
export function validatePersonalityPatch(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('personality_patch_invalid');
  for (const key of Object.keys(patch)) {
    if (!ALLOWED_PERSONALITY_FIELDS.includes(key)) throw new Error('personality_field_forbidden');
  }
  return deepFreeze(patchSchema.parse(patch));
}

export function applyPersonalityPatch(profile, patch) {
  const merged = { ...profile, ...patch };
  if (patch.channelOverrides) {
    const nextOverrides = { ...profile.channelOverrides };
    for (const [channel, override] of Object.entries(patch.channelOverrides)) {
      nextOverrides[channel] = { ...(profile.channelOverrides[channel] ?? {}), ...override };
    }
    merged.channelOverrides = nextOverrides;
  }
  return validateProfile(merged);
}

export function diffProfile(fromProfile, toProfile) {
  const diff = {};
  for (const field of ALLOWED_PERSONALITY_FIELDS) {
    const before = fromProfile?.[field];
    const after = toProfile?.[field];
    if (JSON.stringify(before) !== JSON.stringify(after)) diff[field] = { from: before, to: after };
  }
  return Object.freeze(diff);
}
