// Snapshot d'historique du canal `mina_app` — le module `chat-history-snapshot.mjs` que le plan
// T14 nommait sans qu'il ait jamais existé (divergence relevée par l'audit du 2026-07-24).
//
// HONNÊTETÉ DE PÉRIMÈTRE : la réplication multi-appareils complète du plan (manifeste signé,
// staging Room, GC par ACK) visait une architecture « native-chat-store » qui n'a jamais été
// construite ; l'architecture livrée (chat-server + mémoire) n'en a pas besoin — le téléphone
// détient l'historique durable, le PC retient les échanges en MÉMOIRE (rememberChatExchange).
// Ce module fournit la capacité RÉELLE et utile du même nom : un instantané daté et borné de la
// conversation `mina_app` telle que le PC la connaît (mémoire + état du canal), pour la reprise
// de contexte, le diagnostic et l'export. Rien d'inventé : chaque champ vient d'une source vivante.

export function createChatHistorySnapshot({ memory, channel = null, clock = () => Date.now() } = {}) {
  if (typeof memory?.recentConversation !== 'function') {
    throw new TypeError('chat_history_snapshot_memory_required');
  }

  return Object.freeze({
    /**
     * Instantané borné : les `limit` derniers échanges (tous canaux confondus — Mina est UNE
     * assistante) + l'état réel du canal au même instant. Coffre verrouillé => `entries` vide et
     * `memoryLocked: true`, jamais un historique deviné.
     */
    async capture({ limit = 50 } = {}) {
      const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      let entries = [];
      let memoryLocked = false;
      try {
        entries = await memory.recentConversation({ limit: boundedLimit });
        if (!Array.isArray(entries)) entries = [];
      } catch {
        entries = [];
        memoryLocked = true;
      }
      if (entries.length === 0 && memory.status?.().locked !== false) memoryLocked = true;

      const status = channel?.status?.() ?? null;
      return Object.freeze({
        version: 1,
        capturedAtMs: Number(clock()),
        entryCount: entries.length,
        memoryLocked,
        entries: Object.freeze(entries.map((entry) => Object.freeze({
          content: String(entry.content ?? '').slice(0, 300),
          date: entry.date ?? null,
        }))),
        channel: status ? Object.freeze({
          listening: Boolean(status.listening),
          keyEpoch: status.keyEpoch ?? null,
          connectedDevices: Object.freeze([...(status.connectedDevices ?? [])]),
          processedEvents: status.processedEvents ?? 0,
        }) : null,
      });
    },

    /** Résumé texte prêt à injecter dans un brief de session (jamais plus de ~4 Ko). */
    async brief({ limit = 20 } = {}) {
      const snapshot = await this.capture({ limit });
      if (snapshot.memoryLocked) return 'Historique mina_app indisponible : coffre verrouillé.';
      if (snapshot.entryCount === 0) return 'Aucun échange mina_app retenu pour l’instant.';
      return snapshot.entries.map((entry) => entry.content).join('\n').slice(0, 4_096);
    },
  });
}
