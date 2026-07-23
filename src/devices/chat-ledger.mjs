// Registre des événements déjà traités par le PC (Task 7).
//
// Deux problèmes distincts, deux mécanismes :
//   - REJEU : le même message arrive deux fois (retransmission réseau, ou direct ET cloud).
//     Le ledger garde l'empreinte des événements traités et resert la MÊME réponse au lieu
//     d'en générer une seconde. Sans lui, Nasro verrait Mina répondre deux fois, différemment.
//   - CONCURRENCE : deux copies arrivent en même temps. Une lease par événement garantit qu'une
//     seule génération part ; la seconde attend le résultat de la première.
//
// Le ledger est DURABLE : après un redémarrage du PC, un message redélivré n'est pas retraité.

const DEFAULT_CAPACITY = 2_000;
const LEASE_TIMEOUT_MS = 120_000;

export const CHAT_LEDGER_SCHEMA_VERSION = 1;

/**
 * @param {object} options
 * @param {object} [options.store] store JSON versionné ; absent, le ledger reste en mémoire
 * @param {number} [options.capacity] nombre d'événements retenus
 * @param {() => number} [options.clock]
 */
export function createChatLedger({
  store = null,
  capacity = DEFAULT_CAPACITY,
  clock = Date.now,
  leaseTimeoutMs = LEASE_TIMEOUT_MS,
} = {}) {
  /** eventId -> { answer, atMs } */
  const processed = new Map();
  /** eventId -> Promise en cours */
  const leases = new Map();
  let dirty = false;

  const trim = () => {
    while (processed.size > capacity) {
      // Map conserve l'ordre d'insertion : la plus ancienne entrée part en premier.
      const oldest = processed.keys().next().value;
      processed.delete(oldest);
    }
  };

  return Object.freeze({
    schemaVersion: CHAT_LEDGER_SCHEMA_VERSION,

    async load() {
      if (!store?.load) return;
      const loaded = await store.load({ defaults: null }).catch(() => null);
      for (const entry of loaded?.data?.entries ?? []) {
        if (typeof entry?.eventId === 'string' && typeof entry?.answer === 'string') {
          processed.set(entry.eventId, { answer: entry.answer, atMs: Number(entry.atMs) || 0 });
        }
      }
      trim();
    },

    async persist() {
      if (!store?.save || !dirty) return;
      dirty = false;
      await store.save({
        entries: [...processed.entries()].map(([eventId, value]) => ({
          eventId, answer: value.answer, atMs: value.atMs,
        })),
      }).catch(() => { dirty = true; });
    },

    /** Réponse déjà produite pour cet événement, ou null. */
    recall(eventId) {
      return processed.get(eventId)?.answer ?? null;
    },

    size: () => processed.size,

    /**
     * Exécute `produce` UNE seule fois par eventId. Un rejeu resert la réponse mémorisée ;
     * deux arrivées simultanées partagent la même exécution.
     */
    async once(eventId, produce) {
      const known = processed.get(eventId);
      if (known) return Object.freeze({ answer: known.answer, replayed: true });

      const running = leases.get(eventId);
      if (running) return Object.freeze({ answer: await running, replayed: true });

      const lease = (async () => {
        // Le délai n'annule pas la génération : il évite qu'une génération bloquée retienne
        // indéfiniment tous les rejeux derrière elle.
        const timeout = new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('chat_generation_trop_longue')), leaseTimeoutMs).unref?.();
        });
        return Promise.race([produce(), timeout]);
      })();
      leases.set(eventId, lease);

      try {
        const answer = await lease;
        processed.set(eventId, { answer, atMs: clock() });
        dirty = true;
        trim();
        await this.persist();
        return Object.freeze({ answer, replayed: false });
      } finally {
        leases.delete(eventId);
      }
    },

    /** Nombre de générations réellement en cours — utilisé par les diagnostics. */
    inFlight: () => leases.size,
  });
}
