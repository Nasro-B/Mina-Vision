// Politique d'éligibilité d'un appel entrant (SPEC-MINA-COMMS-001 §7, §9, §11). Décision PURE : Mina
// ne décroche QUE si toutes les conditions matérielles/logicielles sont vraies (§7) ET si l'appel
// passe la politique (numéro, horaires, concurrence, niveau de déploiement). Un appel d'urgence ou un
// numéro court/premium est TOUJOURS refusé. Un seul appel Mina actif en V1 (§11). Un contenu externe
// ne peut jamais rendre un appel éligible. Module PUR, non câblé au runtime.

// Toutes ces conditions doivent être vraies pour qu'un téléphone soit `ready_for_mina_calls` (§7).
export const READINESS_CONDITIONS = Object.freeze([
  'signed_identity', 'adb_endpoint', 'mina_channel', 'phone_role', 'hfp_endpoint',
  'rx_capture', 'tx_injection', 'stt', 'dialogue', 'tts', 'call_policy',
  'emergency_stop_clear', 'no_other_session',
]);

// Niveaux de déploiement (§19). Aucun ne s'active automatiquement.
export const DEPLOYMENT_LEVELS = Object.freeze(['observe', 'assisted', 'pilot', 'dual', 'unknown_numbers']);

const EMERGENCY_NUMBERS = new Set(['15', '17', '18', '112', '114', '115', '116', '119', '191', '196', '197']);

export function evaluateReadiness(state = {}) {
  const missing = READINESS_CONDITIONS.filter((condition) => state[condition] !== true);
  return Object.freeze({ ready: missing.length === 0, missing: Object.freeze(missing) });
}

function isEmergencyOrShort(numberE164) {
  const digits = String(numberE164 ?? '').replace(/[^0-9]/gu, '');
  if (!digits) return true; // masqué / inconnu → prudence
  if (EMERGENCY_NUMBERS.has(digits)) return true;
  return digits.length < 6; // numéros courts / premium
}

function withinHours(atMs, businessHours) {
  if (!businessHours || !Number.isFinite(atMs)) return true;
  const date = new Date(atMs);
  const hour = date.getHours();
  return hour >= (businessHours.startHour ?? 0) && hour < (businessHours.endHour ?? 24);
}

export function evaluateIncomingCall({
  readiness, numberE164 = null, atMs = 0, activeMinaCalls = 0,
  level = 'observe', knownContacts = [], businessHours = null, blockedNumbers = [],
} = {}) {
  // Niveau 0 observation : on ne décroche JAMAIS (§19 niveau 0).
  if (level === 'observe') return { eligible: false, reason: 'observation_only' };
  if (!DEPLOYMENT_LEVELS.includes(level)) return { eligible: false, reason: 'level_unknown' };

  const state = readiness ?? evaluateReadiness({});
  if (!state.ready) return { eligible: false, reason: `not_ready:${state.missing?.[0] ?? 'unknown'}` };

  if (activeMinaCalls >= 1) return { eligible: false, reason: 'concurrent_call' }; // §11 : un seul appel actif
  if (blockedNumbers.includes(numberE164)) return { eligible: false, reason: 'blocked_number' };
  if (isEmergencyOrShort(numberE164)) return { eligible: false, reason: 'emergency_or_short' };

  // Pilote (§19 niveau 2/3) : contacts professionnels connus + horaires ouvrés seulement.
  if ((level === 'pilot' || level === 'dual') && knownContacts.length > 0 && !knownContacts.includes(numberE164)) {
    return { eligible: false, reason: 'unknown_number' };
  }
  if ((level === 'pilot' || level === 'dual') && businessHours && !withinHours(atMs, businessHours)) {
    return { eligible: false, reason: 'outside_hours' };
  }
  return { eligible: true, reason: null };
}
