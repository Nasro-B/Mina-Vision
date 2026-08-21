import { normalizeSmsEvent, classifySmsForTask } from './communication-contract.mjs';

// Ingestion d'un SMS entrant → tâche différée (SPEC-MINA-COMMS-001 §12.3, §13.3, Phase 8). Chaîne :
// normalise → enregistre dans le ledger chiffré (dédup + chiffrement au repos) → classe → si (et
// seulement si) le message est actionnable, enfile une opération de tâche DIFFÉRÉE dans l'outbox. La
// synchronisation Google réelle est un DRAIN séparé (gaté par le compte OAuth) : ici on ne fait
// jamais d'appel réseau. Confidentialité : l'op outbox ne porte que la clé de dédup, jamais le numéro
// ni le texte (§16). Déduplication : un même SMS vu en USB puis en Wi-Fi = une ligne, une seule tâche.
// Module PUR/injectable, DORMANT : rien dans le runtime ne l'appelle encore (le flux Telegram vivant
// n'est pas touché).

const TASK_OPERATION = 'create_communication_task';

export function createSmsTaskIngest({ ledger, outbox, classify = classifySmsForTask } = {}) {
  if (typeof ledger?.record !== 'function' || typeof ledger?.attachTask !== 'function'
    || typeof outbox?.enqueue !== 'function') {
    throw new TypeError('sms_task_ingest_dependencies_required');
  }

  return Object.freeze({
    ingest(rawSms = {}) {
      const event = normalizeSmsEvent(rawSms);
      // Le record est fail-closed : coffre verrouillé + texte sensible → il lève, rien n'est enfilé.
      const recorded = ledger.record(event, { numberE164: event.senderE164, body: event.body });
      if (recorded.deduped) {
        // Déjà vu (autre transport, reprise) : jamais une 2e tâche.
        return Object.freeze({ dedupeKey: event.dedupeKey, recorded: false, deduped: true, task: false });
      }

      const { warrantsTask, category } = classify(event.body, { forced: rawSms.forceTask === true });
      if (!warrantsTask) {
        return Object.freeze({ dedupeKey: event.dedupeKey, recorded: true, deduped: false, task: false, category });
      }

      // Op DIFFÉRÉE : payload minimal NON sensible (dedupeKey seulement). Le drain reconstruit le
      // titre/notes depuis le ledger au moment de la synchro Google.
      const opId = `task-${event.dedupeKey}`;
      outbox.enqueue({ opId, operation: TASK_OPERATION, payload: { dedupeKey: event.dedupeKey }, dedupeKey: event.dedupeKey });
      ledger.attachTask(event.dedupeKey, { syncState: 'queued' });
      return Object.freeze({ dedupeKey: event.dedupeKey, recorded: true, deduped: false, task: true, category, opId });
    },
  });
}
