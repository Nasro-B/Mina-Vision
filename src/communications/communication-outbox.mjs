// Outbox durable des opérations de communication (SPEC-MINA-COMMS-001 §13.3, §15). Toute opération
// réseau (créer/mettre à jour une tâche Google) est écrite dans l'outbox AVANT l'appel : si le réseau
// tombe ou le PC crashe, elle est rejouée. Déduplication par clé (une création incertaine après
// timeout n'est pas refaite deux fois → évite les doublons). Backoff borné, dead-letter au-delà du
// budget. L'ALGORITHME est unique ; le STOCKAGE est injecté (`store`) : défaut en mémoire, ou store
// SQLite persisté fourni par le ledger (`communication-ledger.outboxStore()`). Non câblé au runtime.

export function createInMemoryOutboxStore() {
  const entries = new Map();
  const byDedupe = new Map();
  return {
    get: (opId) => entries.get(opId),
    put: (opId, entry) => { entries.set(opId, entry); },
    remove: (opId) => entries.delete(opId),
    all: () => [...entries.values()],
    dedupeGet: (key) => byDedupe.get(key),
    dedupePut: (key, opId) => { byDedupe.set(key, opId); },
    dedupeRemove: (key) => { byDedupe.delete(key); },
    size: () => entries.size,
  };
}

export function createCommunicationOutbox({
  now = () => 0, maxAttempts = 8, baseDelayMs = 1_000, maxDelayMs = 300_000, store = createInMemoryOutboxStore(),
} = {}) {
  function backoff(attempts) {
    return Math.min(baseDelayMs * 2 ** Math.max(0, attempts - 1), maxDelayMs);
  }

  return Object.freeze({
    enqueue({ opId, operation, payload = {}, dedupeKey = null } = {}) {
      if (!opId || !operation) throw new Error('communication_outbox_operation_invalid');
      // Dédup : une opération déjà en file pour la même clé n'est pas ré-empilée.
      if (dedupeKey) {
        const existing = store.dedupeGet(dedupeKey);
        if (existing) return existing;
      }
      const entry = { opId, operation, payload, dedupeKey, attempts: 0, nextAttemptAt: now(), lastReason: null };
      store.put(opId, entry);
      if (dedupeKey) store.dedupePut(dedupeKey, opId);
      return opId;
    },

    // Opérations dont l'heure de prochaine tentative est atteinte.
    due(atMs = now()) {
      return store.all()
        .filter((entry) => entry.nextAttemptAt <= atMs)
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
        .map((entry) => Object.freeze({ ...entry, payload: { ...entry.payload } }));
    },

    markSuccess(opId) {
      const entry = store.get(opId);
      if (!entry) return false;
      if (entry.dedupeKey) store.dedupeRemove(entry.dedupeKey);
      return store.remove(opId);
    },

    // Échec : incrémente les tentatives, replanifie avec backoff, abandonne (dead-letter) au-delà du budget.
    markFailure(opId, reason = 'unknown') {
      const entry = store.get(opId);
      if (!entry) return { dropped: false, deadLettered: false };
      entry.attempts += 1;
      entry.lastReason = String(reason).slice(0, 200);
      if (entry.attempts >= maxAttempts) {
        if (entry.dedupeKey) store.dedupeRemove(entry.dedupeKey);
        store.remove(opId);
        return { dropped: true, deadLettered: true, attempts: entry.attempts };
      }
      entry.nextAttemptAt = now() + backoff(entry.attempts);
      store.put(opId, entry); // persiste la mutation (indispensable pour le store SQLite)
      return { dropped: false, deadLettered: false, attempts: entry.attempts, nextAttemptAt: entry.nextAttemptAt };
    },

    size: () => store.size(),
    pending: () => store.all().map((entry) => Object.freeze({ opId: entry.opId, operation: entry.operation, attempts: entry.attempts })),
  });
}
