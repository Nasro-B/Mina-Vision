// Synchronisation des tâches de communication vers une liste Google Tasks DÉDIÉE
// (SPEC-MINA-COMMS-001 §13). Gère la liste « Mina — Appels & SMS » : la retrouve par identifiant
// persistant ou par titre EXACT, refuse de fusionner automatiquement des homonymes, la crée sinon, et
// persiste son id. Réconcilie chaque tâche par un marqueur opaque `Mina-ID` (une création incertaine
// après timeout ne fait pas de doublon). Ne met JAMAIS de transcript intégral, d'audio, d'OTP, de
// secret ni de contenu bancaire dans une tâche. L'API Google et le stockage sont INJECTÉS : testable
// sans réseau, non câblé au runtime.

export const DEDICATED_LIST_TITLE = 'Mina — Appels & SMS';
const MINA_ID_PREFIX = 'Mina-ID :';

function channelLabel(event) {
  if (event.kind === 'call') {
    if (event.state === 'missed') return 'appel manqué';
    return event.direction === 'outbound' ? 'appel sortant' : 'appel entrant';
  }
  return event.direction === 'outbound' ? 'SMS sortant' : 'SMS entrant';
}

function titlePrefix(event) {
  if (event.kind === 'call') return event.state === 'missed' ? '[Appel manqué]' : '[Appel]';
  return '[SMS]';
}

// Masque un numéro pour un titre : garde l'indicatif et les 4 derniers chiffres.
function maskNumber(number) {
  const digits = String(number ?? '').replace(/[^0-9+]/gu, '');
  if (digits.length < 6) return digits || 'inconnu';
  return `${digits.slice(0, 4)}••••${digits.slice(-4)}`;
}

export function formatTaskTitle(event = {}, { contactName = null, subject = null } = {}) {
  const who = contactName || (event.numberE164 ? maskNumber(event.numberE164) : 'inconnu');
  const verb = event.kind === 'call'
    ? (event.state === 'missed' ? 'Rappeler' : 'Rappeler')
    : 'Répondre à';
  const tail = subject ? ` — ${String(subject).slice(0, 80)}` : '';
  return `${titlePrefix(event)} ${verb} ${who}${tail}`.slice(0, 200);
}

export function formatTaskNotes(event = {}, { phoneLabel = null, receivedAt = null, callbackNumber = null, slot = null, summary = null } = {}) {
  // Un résumé confirmé peut être inclus, mais jamais un transcript intégral, un OTP, un secret ou un
  // contenu bancaire (le classement en amont a déjà écarté ces catégories).
  return [
    `${MINA_ID_PREFIX} ${event.eventId ?? 'inconnu'}`,
    `Canal : ${channelLabel(event)}`,
    phoneLabel ? `Téléphone : ${phoneLabel}` : null,
    receivedAt ? `Reçu : ${receivedAt}` : null,
    callbackNumber ? `Numéro de rappel : ${callbackNumber}` : null,
    slot ? `Créneau demandé : ${slot}` : null,
    summary ? `Résumé confirmé : ${String(summary).slice(0, 500)}` : null,
  ].filter(Boolean).join('\n');
}

export function createCommunicationTaskSync({ taskApi, store, outbox = null } = {}) {
  if (!taskApi || typeof taskApi.listTaskLists !== 'function' || typeof taskApi.insertTaskList !== 'function' || typeof taskApi.insertTask !== 'function') {
    throw new TypeError('communication_task_sync_api_required');
  }

  async function ensureDedicatedList() {
    const stored = await store?.readTasklistId?.();
    const lists = await taskApi.listTaskLists(); // l'API gère la pagination et renvoie tout
    if (stored && lists.some((list) => list.id === stored)) return stored;

    const matches = lists.filter((list) => list.title === DEDICATED_LIST_TITLE);
    if (matches.length > 1) throw new Error('communication_task_list_ambiguous'); // jamais de fusion auto
    if (matches.length === 1) {
      await store?.writeTasklistId?.(matches[0].id);
      return matches[0].id;
    }
    const created = await taskApi.insertTaskList({ title: DEDICATED_LIST_TITLE });
    await store?.writeTasklistId?.(created.id);
    return created.id;
  }

  // Réconciliation : une tâche portant déjà ce Mina-ID dans ses notes n'est jamais recréée.
  async function findExistingTask(tasklistId, eventId) {
    if (typeof taskApi.listTasks !== 'function' || !eventId) return null;
    const tasks = await taskApi.listTasks({ tasklistId });
    return tasks.find((task) => String(task.notes ?? '').includes(`${MINA_ID_PREFIX} ${eventId}`)) ?? null;
  }

  return Object.freeze({
    ensureDedicatedList,
    async createTaskForEvent(event, meta = {}) {
      const tasklistId = await ensureDedicatedList();
      const existing = await findExistingTask(tasklistId, event.eventId);
      if (existing) return Object.freeze({ taskId: existing.id, tasklistId, reused: true });

      const title = formatTaskTitle(event, meta);
      const notes = formatTaskNotes(event, meta);
      if (outbox && event.eventId) {
        outbox.enqueue({ opId: `task-${event.eventId}`, operation: 'insert_task', payload: { tasklistId, title, notes }, dedupeKey: event.eventId });
      }
      const created = await taskApi.insertTask({ tasklistId, title, notes });
      if (outbox && event.eventId) outbox.markSuccess(`task-${event.eventId}`);
      return Object.freeze({ taskId: created.id, tasklistId, reused: false });
    },
  });
}
