import { createHash } from 'node:crypto';

// Contrats des événements de communication (SPEC-MINA-COMMS-001 §8, §12). Un SMS ou un appel entrant
// est une DONNÉE NON FIABLE : ces contrats ne font que normaliser et déduplicoter, ils n'exécutent
// aucune action et n'exposent aucun outil. Le corps du SMS et la synthèse sont chiffrés PLUS TARD par
// le ledger ; ici on ne garde que des métadonnées + une clé de déduplication multi-transport (un même
// SMS vu en USB et en Wi-Fi = une seule ligne). Module PUR, non câblé au runtime.

const E164 = /^\+?[0-9]{4,15}$/u;

export const SMS_DELIVERY_STATES = Object.freeze(['prepared', 'queued', 'sent', 'delivered', 'failed']);
export const CALL_STATES = Object.freeze(['ringing', 'answered', 'missed', 'refused', 'ended', 'ineligible']);
export const CALL_ACTORS = Object.freeze(['mina', 'nasro', 'other', 'unknown']);

function dedupe(parts) {
  return createHash('sha256').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 32);
}

export function normalizeSmsEvent(input = {}) {
  const deviceId = String(input.deviceId ?? '');
  if (!deviceId) throw new Error('communication_device_required'); // jamais « le premier »
  const direction = input.direction === 'outbound' ? 'outbound' : 'inbound';
  const messageId = String(input.messageId ?? '');
  const sender = String(input.senderE164 ?? '');
  const subscriptionId = input.subscriptionId ? String(input.subscriptionId) : 'sim_ambiguous';
  const sentAtMs = Number.isFinite(input.sentAtMs) ? input.sentAtMs : 0;
  return Object.freeze({
    kind: 'sms',
    eventId: String(input.eventId ?? '') || null,
    deviceId,
    subscriptionId,
    messageId,
    direction,
    senderE164: E164.test(sender) ? sender : null,
    sentAtMs,
    receivedAtMs: Number.isFinite(input.receivedAtMs) ? input.receivedAtMs : 0,
    body: typeof input.body === 'string' ? input.body : '', // chiffré en aval par le ledger
    transport: input.transport ? String(input.transport) : null,
    deliveryState: SMS_DELIVERY_STATES.includes(input.deliveryState) ? input.deliveryState : 'prepared',
    // Clé de dédup : indépendante du transport (USB/Wi-Fi) → un seul événement pour un même SMS.
    dedupeKey: dedupe([deviceId, direction, messageId, sender, String(sentAtMs)]),
  });
}

export function normalizeCallEvent(input = {}) {
  const deviceId = String(input.deviceId ?? '');
  if (!deviceId) throw new Error('communication_device_required');
  const state = CALL_STATES.includes(input.state) ? input.state : 'ringing';
  const number = String(input.numberE164 ?? '');
  return Object.freeze({
    kind: 'call',
    eventId: String(input.eventId ?? '') || null,
    deviceId,
    subscriptionId: input.subscriptionId ? String(input.subscriptionId) : 'sim_ambiguous',
    callId: String(input.callId ?? ''),
    state,
    direction: input.direction === 'outbound' ? 'outbound' : 'inbound',
    // L'acteur n'est JAMAIS déduit : « mina » exige une corrélation de session (§14.3).
    actor: CALL_ACTORS.includes(input.actor) ? input.actor : 'unknown',
    numberE164: E164.test(number) ? number : null,
    atMs: Number.isFinite(input.atMs) ? input.atMs : 0,
    durationMs: Number.isFinite(input.durationMs) && input.durationMs >= 0 ? input.durationMs : 0,
    dedupeKey: dedupe([deviceId, 'call', String(input.callId ?? ''), state, String(input.atMs ?? 0)]),
  });
}

// §12.3 / §8.5 : un SMS ne crée une tâche QUE s'il est actionnable (rappel/réponse demandé, action
// commerciale légitime). JAMAIS pour OTP, alerte bancaire, pub, spam, notification opérateur ou
// message système. Classement CONSERVATEUR : dans le doute, pas de tâche automatique (Nasro peut
// toujours « Transformer en tâche » manuellement).
// Patterns sur texte NORMALISÉ (accents retirés, minuscules, tirets → espace). En PRÉFIXE quand un
// mot a des flexions (rappel → rappeler/rappelle/rappelez).
const OTP = /\b(code|otp|verification|confirmation)\b.*\d{4,8}|\d{4,8}.*\b(code|verification)\b/u;
const BANK = /\b(virement|carte bancaire|solde|debit|credit|banque|paiement de|prelevement)\b/u;
const ADS = /\b(promo|reduction|offre speciale|gratuit|abonnez|desabonner|stop au \d)\b/u;
const OPERATOR = /\b(forfait|consommation data|recharge|orange|sfr|bouygues|free mobile)\b/u;
const ACTIONABLE = /\b(rappel|repond|reponse|urgent|peux tu|pouvez vous|rendez vous|confirm|disponib)/u;

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[-']/gu, ' ')
    .replace(/\s+/gu, ' ');
}

// Mappe un SMS entrant du pull ADB (forme vérifiée dans phone-bridge : { body, channel:'sms', id,
// sender, sentAtMs }) vers l'entrée de normalizeSmsEvent. Le pull ne porte PAS de subscriptionId → la
// SIM reste ambiguë ('sim_ambiguous', résolu par normalizeSmsEvent). eventId réutilise l'id du message.
export function mapPulledSmsToEvent(message = {}, deviceId) {
  return {
    deviceId,
    messageId: String(message.id ?? ''),
    eventId: String(message.id ?? '') || null,
    senderE164: message.sender,
    body: typeof message.body === 'string' ? message.body : '',
    sentAtMs: Number.isFinite(message.sentAtMs) ? message.sentAtMs : 0,
    direction: 'inbound',
  };
}

export function classifySmsForTask(body = '', { forced = false } = {}) {
  if (forced) return { warrantsTask: true, category: 'forced' };
  const text = normalizeText(body);
  if (OTP.test(text)) return { warrantsTask: false, category: 'otp' };
  if (BANK.test(text)) return { warrantsTask: false, category: 'bank' };
  if (OPERATOR.test(text)) return { warrantsTask: false, category: 'operator' };
  if (ADS.test(text)) return { warrantsTask: false, category: 'ads' };
  if (ACTIONABLE.test(text)) return { warrantsTask: true, category: 'actionable' };
  return { warrantsTask: false, category: 'unknown' };
}
