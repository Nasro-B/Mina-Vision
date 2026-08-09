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

import { createMonotonicUlid } from '../contracts/event-id.mjs';

const DEFAULT_CAPACITY = 2_000;
const LEASE_TIMEOUT_MS = 120_000;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

// Version du contenu du ledger (dans l'enveloppe versionnée générique de userData). La version
// de l'enveloppe reste gérée par createVersionedJsonStore ; celle-ci permet de migrer les
// anciennes réponses finales vers les enregistrements de stream sans les perdre.
export const CHAT_LEDGER_SCHEMA_VERSION = 2;

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
  /** eventId -> { responseId, chunks, answer, atMs }; answer null = stream incomplet local */
  const processed = new Map();
  /** eventId -> Promise en cours */
  const leases = new Map();
  /** sourceEventId -> Promise du stream en cours */
  const streamLeases = new Map();
  const defaultMakeResponseId = createMonotonicUlid();
  let dirty = false;
  let persistence = Promise.resolve();

  const isComplete = (record) => typeof record?.answer === 'string';

  const snapshot = () => ({
    schemaVersion: CHAT_LEDGER_SCHEMA_VERSION,
    entries: [...processed.entries()].map(([eventId, value]) => ({
      eventId,
      responseId: value.responseId,
      chunks: [...value.chunks],
      answer: value.answer,
      atMs: value.atMs,
    })),
  });

  const resultFor = (record, replayed) => Object.freeze({
    responseId: record.responseId,
    chunks: Object.freeze([...record.chunks]),
    answer: record.answer,
    replayed,
  });

  const requireResponseId = (responseId) => {
    if (!ULID_PATTERN.test(responseId)) throw new Error('chat_stream_response_id_invalide');
    return responseId;
  };

  const runWithLeaseTimeout = (produce) => {
    let timeoutId = null;
    let generated;
    try {
      // Conserver l'appel synchronement déclenché du ledger historique : les deux arrivées du
      // même tour doivent observer la lease immédiatement, avant le premier await du producteur.
      generated = produce();
    } catch (error) {
      return Promise.reject(error);
    }
    const timeout = new Promise((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error('chat_generation_trop_longue')), leaseTimeoutMs);
      timeoutId.unref?.();
    });
    return Promise.race([generated, timeout])
      .finally(() => clearTimeout(timeoutId));
  };

  const flush = async ({ required = false } = {}) => {
    if (!store?.save || !dirty) return true;
    const scheduled = persistence.then(async () => {
      if (!dirty) return true;
      const data = snapshot();
      dirty = false;
      try {
        await store.save(data);
        return true;
      } catch (error) {
        dirty = true;
        if (required) throw new Error('chat_ledger_persistance_echouee', { cause: error });
        return false;
      }
    });
    persistence = scheduled.catch(() => {});
    return scheduled;
  };

  const trim = () => {
    while (processed.size > capacity) {
      // Map conserve l'ordre d'insertion : la plus ancienne entrée part en premier.
      const oldest = processed.keys().next().value;
      processed.delete(oldest);
    }
  };

  const ledger = {
    schemaVersion: CHAT_LEDGER_SCHEMA_VERSION,

    async load() {
      if (!store?.load) return;
      const loaded = await store.load({ defaults: null }).catch(() => null);
      const data = loaded?.data;
      // Une version future est volontairement ignorée : la façade versionnée garde le fichier
      // intact, plutôt que de risquer d'écraser un format que ce binaire ne comprend pas.
      if (data?.schemaVersion !== undefined && data.schemaVersion !== CHAT_LEDGER_SCHEMA_VERSION) return;

      let migrated = data?.schemaVersion !== CHAT_LEDGER_SCHEMA_VERSION;
      for (const entry of data?.entries ?? []) {
        if (typeof entry?.eventId !== 'string' || typeof entry?.answer !== 'string') {
          migrated = true;
          continue;
        }
        const chunks = Array.isArray(entry.chunks) && entry.chunks.every((chunk) => typeof chunk === 'string' && chunk.length > 0)
          && entry.chunks.join('') === entry.answer
          ? [...entry.chunks]
          : [];
        const responseId = ULID_PATTERN.test(entry.responseId) ? entry.responseId : null;
        if (responseId === null || chunks.length !== (entry.chunks?.length ?? 0)) migrated = true;
        processed.set(entry.eventId, {
          responseId,
          chunks,
          answer: entry.answer,
          atMs: Number(entry.atMs) || 0,
        });
      }
      trim();
      if (migrated && data) {
        dirty = true;
        await flush();
      }
    },

    async persist() {
      return flush();
    },

    /** Réponse déjà produite pour cet événement, ou null. */
    recall(eventId) {
      const record = processed.get(eventId);
      return isComplete(record) ? record.answer : null;
    },

    size: () => processed.size,

    /**
     * Exécute `produce` UNE seule fois par eventId. Un rejeu resert la réponse mémorisée ;
     * deux arrivées simultanées partagent la même exécution.
     */
    async once(eventId, produce) {
      const known = processed.get(eventId);
      if (isComplete(known)) return Object.freeze({ answer: known.answer, replayed: true });

      const running = leases.get(eventId);
      if (running) return Object.freeze({ answer: await running, replayed: true });

      const lease = runWithLeaseTimeout(produce);
      leases.set(eventId, lease);

      try {
        const answer = await lease;
        processed.set(eventId, { responseId: null, chunks: [], answer, atMs: clock() });
        dirty = true;
        trim();
        await flush();
        return Object.freeze({ answer, replayed: false });
      } finally {
        leases.delete(eventId);
      }
    },

    /**
     * Persiste une réponse progressive UNE seule fois. `append` attend la sauvegarde avant de
     * rendre la main au fournisseur ; l'appelant peut donc émettre le fragment seulement après.
     */
    async streamOnce(sourceEventId, produce, { makeResponseId = defaultMakeResponseId } = {}) {
      if (typeof produce !== 'function' || typeof makeResponseId !== 'function') {
        throw new TypeError('chat_stream_generation_invalide');
      }
      const running = streamLeases.get(sourceEventId);
      if (running) {
        const result = await running;
        return resultFor(result, true);
      }

      const known = processed.get(sourceEventId);
      if (isComplete(known) && known.responseId) return resultFor(known, true);
      const replayingLegacy = isComplete(known);

      const lease = (async () => {
        if (isComplete(known)) {
          // Ancien ledger final-only : lui attribuer un identifiant au premier rejeu, sans appeler
          // le modèle ni inventer de chunks qui n'ont jamais existé.
          const previousResponseId = known.responseId;
          known.responseId = requireResponseId(makeResponseId());
          dirty = true;
          try {
            await flush({ required: true });
          } catch (error) {
            // L'identifiant ne devient réutilisable qu'après persistance confirmée. Sinon un
            // nouveau rejeu doit retenter la migration plutôt que d'émettre une trame volatile.
            known.responseId = previousResponseId;
            dirty = true;
            throw error;
          }
          return known;
        }

        const record = {
          responseId: requireResponseId(makeResponseId()),
          chunks: [],
          answer: null,
          atMs: clock(),
        };
        processed.set(sourceEventId, record);
        dirty = true;
        trim();
        await flush({ required: true });

        let active = true;
        const append = async (delta) => {
          if (!active) throw new Error('chat_stream_expire');
          if (typeof delta !== 'string' || delta.length === 0) throw new Error('chat_stream_fragment_invalide');
          record.chunks.push(delta);
          dirty = true;
          await flush({ required: true });
        };

        try {
          const answer = await runWithLeaseTimeout(() => produce({ responseId: record.responseId, append }));
          // Un fournisseur final-only est légitime : il produit started → completed sans chunk
          // synthétique. Dès qu'il a fourni au moins un delta, la concaténation doit en revanche
          // être le final canonique exact.
          if (typeof answer !== 'string' || (record.chunks.length > 0 && record.chunks.join('') !== answer)) {
            throw new Error('chat_stream_answer_incoherent');
          }
          record.answer = answer;
          record.atMs = clock();
          dirty = true;
          trim();
          await flush({ required: true });
          return record;
        } catch (error) {
          active = false;
          if (processed.get(sourceEventId) === record) {
            processed.delete(sourceEventId);
            dirty = true;
            await flush();
          }
          throw error;
        } finally {
          active = false;
        }
      })();
      streamLeases.set(sourceEventId, lease);

      try {
        return resultFor(await lease, replayingLegacy);
      } finally {
        streamLeases.delete(sourceEventId);
      }
    },

    /** Nombre de générations réellement en cours — utilisé par les diagnostics. */
    inFlight: () => leases.size + streamLeases.size,
  };

  return Object.freeze(ledger);
}
