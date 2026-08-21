// Adaptateur Google Tasks MULTI-LISTES (SPEC-MINA-COMMS-001 §13). L'adaptateur personnel existant
// (google-personal.mjs) n'opère que sur la liste @default ; le domaine communications a besoin d'une
// liste DÉDIÉE (« Mina — Appels & SMS »), donc de lister/créer des listes et d'insérer/lister des
// tâches dans une liste précise. Implémente exactement le contrat `taskApi` attendu par
// communication-task-sync (listTaskLists / insertTaskList / insertTask / listTasks). La couche HTTP
// OAuth est INJECTÉE (même forme que google-personal : oauth.request(credentials, {url,method,data})),
// donc testable sans réseau. Ne devient réel qu'une fois le compte Google OAuth `mina-vision` connecté.

const LISTS_URL = 'https://tasks.googleapis.com/tasks/v1/users/@me/lists';
const tasksUrl = (tasklistId) => `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks`;

export function createGoogleTasksListAdapter({ oauth, credentialsProvider } = {}) {
  if (!oauth?.request) throw new TypeError('google_tasks_oauth_required');
  if (typeof credentialsProvider !== 'function') throw new TypeError('google_tasks_credentials_provider_required');

  async function call(options) {
    const credentials = await credentialsProvider();
    const response = await oauth.request(credentials, options);
    return response.data;
  }

  return Object.freeze({
    async listTaskLists() {
      const data = await call({ url: LISTS_URL, method: 'GET' });
      return (data?.items ?? []).map((raw) => ({ id: String(raw.id), title: String(raw.title ?? '') }));
    },

    async insertTaskList({ title } = {}) {
      if (typeof title !== 'string' || !title.trim()) throw new TypeError('google_tasklist_title_invalid');
      const data = await call({ url: LISTS_URL, method: 'POST', data: { title: title.trim() } });
      if (typeof data?.id !== 'string' || !data.id) throw new Error('google_tasklist_create_response_invalid');
      return { id: data.id, title: data.title ?? title.trim() };
    },

    async insertTask({ tasklistId, title, notes } = {}) {
      if (typeof tasklistId !== 'string' || !tasklistId) throw new TypeError('google_task_tasklist_required');
      if (typeof title !== 'string' || !title.trim()) throw new TypeError('google_task_title_invalid');
      const data = await call({
        url: tasksUrl(tasklistId),
        method: 'POST',
        data: { title: title.trim(), ...(notes ? { notes: String(notes) } : {}) },
      });
      if (typeof data?.id !== 'string' || !data.id) throw new Error('google_task_create_response_invalid');
      return { id: data.id, etag: data.etag ?? null };
    },

    async listTasks({ tasklistId } = {}) {
      if (typeof tasklistId !== 'string' || !tasklistId) throw new TypeError('google_task_tasklist_required');
      const data = await call({ url: tasksUrl(tasklistId), method: 'GET' });
      return (data?.items ?? []).map((raw) => ({ id: String(raw.id), notes: raw.notes ?? '', title: raw.title ?? '' }));
    },
  });
}
