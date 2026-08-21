// Drain de l'outbox → Google Tasks (SPEC-MINA-COMMS-001 §13.3, Phase 9). Boucle de rejeu durable :
// prend les opérations DUES de l'outbox, reconstruit l'événement depuis le ledger (le titre ne porte
// qu'un numéro MASQUÉ, jamais le texte du SMS), délègue la création à communication-task-sync (l'API
// Google est INJECTÉE : réel en prod, fake en test), puis marque succès/échec sur l'outbox et l'état
// de synchro dans le ledger. Le vrai appel Google est gaté par le compte OAuth ; cette orchestration
// est testée offline de bout en bout. Module PUR/injectable, non câblé au runtime.

const TASK_OPERATION = 'create_communication_task';

export function createCommunicationTaskDrain({ ledger, outbox, taskSync, now = () => Date.now() } = {}) {
  if (typeof ledger?.get !== 'function' || typeof ledger?.getPayload !== 'function' || typeof ledger?.attachTask !== 'function'
    || typeof outbox?.due !== 'function' || typeof outbox?.markSuccess !== 'function' || typeof outbox?.markFailure !== 'function'
    || typeof taskSync?.createTaskForEvent !== 'function') {
    throw new TypeError('communication_task_drain_dependencies_required');
  }

  return Object.freeze({
    async drainOnce({ atMs = now() } = {}) {
      let processed = 0;
      let synced = 0;
      let failed = 0;
      let dropped = 0;

      for (const op of outbox.due(atMs)) {
        if (op.operation !== TASK_OPERATION) continue; // pas notre opération
        processed += 1;
        const dedupeKey = op.payload?.dedupeKey;
        const event = dedupeKey ? ledger.get(dedupeKey) : null;
        if (!event) {
          // Orpheline (événement purgé/absent) : on abandonne proprement, jamais de boucle.
          outbox.markSuccess(op.opId);
          dropped += 1;
          continue;
        }
        let payload = null;
        try { payload = ledger.getPayload(dedupeKey); } catch { payload = null; }
        const taskEvent = {
          kind: event.kind,
          direction: event.direction,
          state: event.state,
          numberE164: payload?.numberE164 ?? null, // masqué par task-sync ; jamais le numéro brut dans la tâche
          eventId: event.eventId ?? dedupeKey, // id stable pour le marqueur Mina-ID (réconciliation)
        };
        try {
          const result = await taskSync.createTaskForEvent(taskEvent, {});
          outbox.markSuccess(op.opId);
          ledger.attachTask(dedupeKey, { tasklistId: result.tasklistId, providerTaskId: result.taskId, syncState: 'synced' });
          synced += 1;
        } catch (error) {
          const outcome = outbox.markFailure(op.opId, error.message);
          ledger.attachTask(dedupeKey, { syncState: outcome.deadLettered ? 'dead_letter' : 'retry' });
          failed += 1;
        }
      }

      return Object.freeze({ processed, synced, failed, dropped });
    },
  });
}
