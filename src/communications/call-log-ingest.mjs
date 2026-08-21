import { normalizeCallEvent } from './communication-contract.mjs';

// Ingestion du JOURNAL D'APPELS → tâche de rappel (SPEC-MINA-COMMS-001 §8.5, §11). Chemin SANS audio :
// on lit le call log du téléphone via ADB (`content query --uri content://call_log/calls`), on ne garde
// que les appels MANQUÉS, et on crée une tâche « Rappeler » (dédupliquée). Aucun outil PC exposé, aucun
// contenu vocal. Un numéro d'urgence/court non rappelable est enregistré mais ne crée pas de tâche. Le
// numéro reste chiffré au repos par le ledger et absent de l'op outbox. Module PUR/injectable, dormant.

const CALL_TYPE_MISSED = 3; // 1=entrant 2=sortant 3=manqué 4=messagerie 5=refusé 6=bloqué

// Parse la sortie texte de `adb shell content query` : « Row: N key=val, key=val, ... ».
export function parseCallLog(text = '') {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!/^\s*Row:/u.test(line)) continue;
    const field = (key) => {
      const match = new RegExp(`${key}=([^,]*)`, 'u').exec(line);
      return match ? match[1].trim() : null;
    };
    const number = field('number');
    rows.push(Object.freeze({
      number: number && number !== 'NULL' ? number : null,
      type: Number(field('type')) || 0,
      date: Number(field('date')) || 0,
      duration: Number(field('duration')) || 0,
    }));
  }
  return rows;
}

export function createCallLogIngest({ ledger, outbox, deviceId, now = () => Date.now() } = {}) {
  if (typeof ledger?.record !== 'function' || typeof ledger?.attachTask !== 'function'
    || typeof outbox?.enqueue !== 'function' || !deviceId) {
    throw new TypeError('call_log_ingest_dependencies_required');
  }

  return Object.freeze({
    ingest(entries = []) {
      let processed = 0;
      let missed = 0;
      let tasksQueued = 0;
      let deduped = 0;

      for (const entry of entries ?? []) {
        processed += 1;
        if (Number(entry?.type) !== CALL_TYPE_MISSED) continue; // seuls les manqués → tâche de rappel
        missed += 1;
        const date = Number(entry.date) || now();
        const event = normalizeCallEvent({
          deviceId, callId: `log-${date}`, state: 'missed', direction: 'inbound',
          numberE164: entry.number, atMs: date,
        });
        const recorded = ledger.record(event, { numberE164: event.numberE164 });
        if (recorded.deduped) { deduped += 1; continue; } // journal re-lu : jamais de doublon de tâche
        // numberE164 est null pour un numéro d'urgence/court (non rappelable) → enregistré, pas de tâche.
        if (!event.numberE164) continue;
        const opId = `task-${event.dedupeKey}`;
        outbox.enqueue({ opId, operation: 'create_communication_task', payload: { dedupeKey: event.dedupeKey }, dedupeKey: event.dedupeKey });
        ledger.attachTask(event.dedupeKey, { syncState: 'queued' });
        tasksQueued += 1;
      }

      return Object.freeze({ processed, missed, tasksQueued, deduped });
    },
  });
}
