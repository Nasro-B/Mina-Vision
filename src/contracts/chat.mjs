// Contrat des événements du canal `mina_app` (chat natif Android). Version 2 de l'enveloppe :
// v1 (SMS/Telegram) reste acceptée telle quelle par son propre schéma — les deux coexistent.
//
// Règle de fond : un événement est APPEND-ONLY. Une correction, un statut ou une suppression
// est un NOUVEL événement signé ; aucun client ne réécrit le contenu d'un événement existant.

import { z } from 'zod';

export const CHAT_ENVELOPE_VERSION = 2;

// Classes de routage volontairement GROSSIÈRES : elles voyagent en clair (le serveur doit
// pouvoir router sans déchiffrer), donc elles ne doivent rien révéler du contenu.
export const CHAT_ROUTING_CLASSES = Object.freeze(['message', 'receipt', 'control', 'stream', 'approval']);

// Types réels de l'événement — CHIFFRÉS dans le payload, jamais en clair sur le réseau.
export const CHAT_EVENT_TYPES = Object.freeze([
  'message.text.created', 'message.attachment.created', 'message.voice.created',
  'message.status.changed', 'assistant.response.started', 'assistant.response.chunk',
  'assistant.response.completed', 'assistant.response.failed', 'approval.requested',
  'approval.approved', 'approval.denied', 'device.role.changed', 'device.endpoint.changed', 'device.revoked',
  'history.snapshot.available', 'thread.created', 'thread.renamed', 'thread.archived', 'thread.tombstoned', 'thread.purged',
]);

// Bornes interopérables Node ↔ Kotlin ↔ Firestore.
export const MAX_SAFE_SEQUENCE = Number.MAX_SAFE_INTEGER; // 9 007 199 254 740 991
export const MAX_KEY_EPOCH = 2_147_483_647; // borne de l'Int Kotlin
export const MAX_CIPHERTEXT_BASE64 = 196_608; // marge sous le plafond Firestore de 256 KiB
export const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;

// Base64 CANONIQUE : un décodage suivi d'un réencodage doit rendre exactement la même chaîne.
// Sans cette vérification, deux encodages différents du même contenu produiraient deux digests
// différents — et l'anti-replay par digest deviendrait contournable.
const decodeCanonicalBase64 = (value) => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 !== 0) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
};

const base64OfExactBytes = (expected, label) => z.string().refine((value) => {
  const bytes = decodeCanonicalBase64(value);
  return bytes !== null && bytes.length === expected;
}, { message: `${label}_invalide` });

// Signature ES256 : DER canonique, 8 à 72 octets → 96 caractères base64 au maximum.
const derSignatureSchema = z.string().max(96).refine((value) => {
  const bytes = decodeCanonicalBase64(value);
  if (bytes === null || bytes.length < 8 || bytes.length > 72) return false;
  return bytes[0] === 0x30 && bytes[1] === bytes.length - 2;
}, { message: 'signature_der_invalide' });

const chatEventSchema = z.strictObject({
  version: z.literal(CHAT_ENVELOPE_VERSION),
  eventId: z.string().regex(ULID_PATTERN, 'event_id_ulid_invalide'),
  threadId: z.string().regex(IDENTIFIER_PATTERN, 'thread_id_invalide'),
  senderDeviceId: z.string().regex(IDENTIFIER_PATTERN, 'sender_device_id_invalide'),
  deviceSequence: z.number().int().positive().max(MAX_SAFE_SEQUENCE),
  keyEpoch: z.number().int().positive().max(MAX_KEY_EPOCH),
  routingClass: z.enum(CHAT_ROUTING_CLASSES),
  createdAtMs: z.number().int().positive().max(MAX_SAFE_SEQUENCE),
  expiresAtMs: z.number().int().positive().max(MAX_SAFE_SEQUENCE),
  payloadCiphertext: z.string().min(1).max(MAX_CIPHERTEXT_BASE64)
    .refine((value) => decodeCanonicalBase64(value) !== null, { message: 'ciphertext_base64_non_canonique' }),
  nonce: base64OfExactBytes(12, 'nonce'),
  authTag: base64OfExactBytes(16, 'auth_tag'),
  signature: derSignatureSchema,
}).refine((event) => event.expiresAtMs > event.createdAtMs, {
  message: 'expiration_anterieure_a_la_creation',
}).refine((event) => event.expiresAtMs - event.createdAtMs <= MAX_TTL_MS, {
  message: 'ttl_superieur_a_30_jours',
});

export function parseChatEvent(value) {
  const result = chatEventSchema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(`chat_event_invalide:${first?.message ?? 'inconnu'}`);
  }
  return Object.freeze({ ...result.data });
}

export function isChatEvent(value) {
  return chatEventSchema.safeParse(value).success;
}
