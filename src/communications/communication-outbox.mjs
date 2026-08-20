// Outbox durable des opérations de communication (SPEC-MINA-COMMS-001 §13.3, §15). Toute opération
// réseau (créer/mettre à jour une tâche Google) est écrite dans l'outbox AVANT l'appel : si le réseau
// tombe ou le PC crashe, elle est rejouée. Déduplication par clé (une création incertaine après
// timeout n'est pas refaite deux fois → évite les doublons). Backoff borné. Module PUR (état en
// mémoire ici ; la persistance SQLite sera branchée en aval), non câblé au runtime.

export function createCommunicationOutbox({
  now = () => 0, maxAttempts = 8, baseDelayMs = 1_000, maxDelayMs = 300_000,
} = {}) {
  const entries = new Map(); // opId -> entry
  const byDedupe = new Map(); // dedupeKey -> opId

  function backoff(attempts) {
    return Math.min(baseDelayMs * 2 ** Math.max(0, attempts - 1), maxDelayMs);
  }

  return Object.freeze({
    enqueue({ opId, operation, payload = {}, dedupeKey = null } = {}) {
      if (!opId || !operation) throw new Error('communication_outbox_operation_invalid');
      // Dédup : une opération déjà en file pour la même clé n'est pas ré-empilée.
      if (dedupeKey && byDedupe.has(dedupeKey)) return byDedupe.get(dedupeKey);
      const entry = { opId, operation, payload, dedupeKey, attempts: 0, nextAttemptAt: now(), lastReason: null };
      entries.set(opId, entry);
      if (dedupeKey) byDedupe.set(dedupeKey, opId);
      return opId;
    },

    // Opérations dont l'heure de prochaine tentative est atteinte.
    due(atMs = now()) {
      return [...entries.values()]
        .filter((entry) => entry.nextAttemptAt <= atMs)
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
        .map((entry) => Object.freeze({ ...entry, payload: { ...entry.payload } }));
    },

    markSuccess(opId) {
      const entry = entries.get(opId);
      if (!entry) return false;
      if (entry.dedupeKey) byDedupe.delete(entry.dedupeKey);
      return entries.delete(opId);
    },

    // Échec : incrémente les tentatives, replanifie avec backoff, abandonne (dead-letter) au-delà du budget.
    markFailure(opId, reason = 'unknown') {
      const entry = entries.get(opId);
      if (!entry) return { dropped: false, deadLettered: false };
      entry.attempts += 1;
      entry.lastReason = String(reason).slice(0, 200);
      if (entry.attempts >= maxAttempts) {
        if (entry.dedupeKey) byDedupe.delete(entry.dedupeKey);
        entries.delete(opId);
        return { dropped: true, deadLettered: true, attempts: entry.attempts };
      }
      entry.nextAttemptAt = now() + backoff(entry.attempts);
      return { dropped: false, deadLettered: false, attempts: entry.attempts, nextAttemptAt: entry.nextAttemptAt };
    },

    size: () => entries.size,
    pending: () => [...entries.values()].map((entry) => Object.freeze({ opId: entry.opId, operation: entry.operation, attempts: entry.attempts })),
  });
}
