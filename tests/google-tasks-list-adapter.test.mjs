import { describe, expect, it } from 'vitest';
import { createGoogleTasksListAdapter } from '../src/personal/adapters/google-tasks-list-adapter.mjs';
import { createCommunicationTaskSync } from '../src/personal/communication-task-sync.mjs';

// Fake de la couche HTTP OAuth (même forme que google-personal : oauth.request(creds, {url,method,data})).
function fakeOauth(responses = {}) {
  const requests = [];
  return {
    requests,
    request(_credentials, options) {
      requests.push(options);
      const key = `${options.method} ${options.url}`;
      const data = responses[key] ?? (options.method === 'POST' ? { id: 'GEN', title: options.data?.title } : { items: [] });
      return Promise.resolve({ data });
    },
  };
}
const creds = () => ({ token: 't' });
const LISTS = 'https://tasks.googleapis.com/tasks/v1/users/@me/lists';

describe('google-tasks-list-adapter (contrat taskApi multi-listes)', () => {
  it('liste les listes de tâches', async () => {
    const oauth = fakeOauth({ [`GET ${LISTS}`]: { items: [{ id: 'L1', title: 'Perso' }, { id: 'L2', title: 'Mina — Appels & SMS' }] } });
    const api = createGoogleTasksListAdapter({ oauth, credentialsProvider: creds });
    const lists = await api.listTaskLists();
    expect(lists).toEqual([{ id: 'L1', title: 'Perso' }, { id: 'L2', title: 'Mina — Appels & SMS' }]);
  });

  it('crée une liste et une tâche dans cette liste (bonnes URLs REST)', async () => {
    const oauth = fakeOauth({ [`POST ${LISTS}`]: { id: 'L9', title: 'Mina — Appels & SMS' } });
    const api = createGoogleTasksListAdapter({ oauth, credentialsProvider: creds });
    const list = await api.insertTaskList({ title: 'Mina — Appels & SMS' });
    expect(list.id).toBe('L9');
    await api.insertTask({ tasklistId: 'L9', title: '[SMS] Répondre à +336••••5678', notes: 'Mina-ID : evt-1' });
    const post = oauth.requests.find((r) => r.url === 'https://tasks.googleapis.com/tasks/v1/lists/L9/tasks' && r.method === 'POST');
    expect(post).toBeTruthy();
    expect(post.data).toMatchObject({ title: '[SMS] Répondre à +336••••5678', notes: 'Mina-ID : evt-1' });
  });

  it('refuse une tâche sans liste ou sans titre', async () => {
    const api = createGoogleTasksListAdapter({ oauth: fakeOauth(), credentialsProvider: creds });
    await expect(api.insertTask({ title: 'x' })).rejects.toThrow('google_task_tasklist_required');
    await expect(api.insertTask({ tasklistId: 'L1', title: '  ' })).rejects.toThrow('google_task_title_invalid');
  });

  it('intégration : communication-task-sync crée sa liste dédiée + une tâche via cet adaptateur', async () => {
    const oauth = fakeOauth({
      [`GET ${LISTS}`]: { items: [] }, // aucune liste existante
      [`POST ${LISTS}`]: { id: 'Lmina', title: 'Mina — Appels & SMS' },
    });
    const api = createGoogleTasksListAdapter({ oauth, credentialsProvider: creds });
    const sync = createCommunicationTaskSync({ taskApi: api, store: (() => { let id = null; return { async readTasklistId() { return id; }, async writeTasklistId(v) { id = v; } }; })() });
    const result = await sync.createTaskForEvent({ kind: 'sms', direction: 'inbound', eventId: 'evt-1', numberE164: '+33612345678' });
    expect(result.tasklistId).toBe('Lmina');
    // Une tâche a bien été postée dans la liste dédiée fraîchement créée.
    const taskPost = oauth.requests.find((r) => r.url === 'https://tasks.googleapis.com/tasks/v1/lists/Lmina/tasks' && r.method === 'POST');
    expect(taskPost).toBeTruthy();
    expect(String(taskPost.data.title)).toContain('••••'); // numéro masqué, jamais complet
  });
});
