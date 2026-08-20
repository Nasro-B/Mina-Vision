import { describe, expect, it } from 'vitest';
import {
  DEDICATED_LIST_TITLE, createCommunicationTaskSync, formatTaskNotes, formatTaskTitle,
} from '../src/personal/communication-task-sync.mjs';

function fakeApi(initialLists = []) {
  const lists = [...initialLists];
  const tasks = new Map();
  let seq = 0;
  return {
    listTaskLists: async () => lists.map((l) => ({ ...l })),
    insertTaskList: async ({ title }) => { const l = { id: `list-${(seq += 1)}`, title }; lists.push(l); return l; },
    insertTask: async ({ tasklistId, title, notes }) => {
      const t = { id: `task-${(seq += 1)}`, title, notes };
      if (!tasks.has(tasklistId)) tasks.set(tasklistId, []);
      tasks.get(tasklistId).push(t);
      return t;
    },
    listTasks: async ({ tasklistId }) => (tasks.get(tasklistId) ?? []).map((t) => ({ ...t })),
    _tasks: tasks,
  };
}
function fakeStore() {
  let id = null;
  return { readTasklistId: async () => id, writeTasklistId: async (x) => { id = x; } };
}

describe('communication-task-sync : liste dédiée (§13.1)', () => {
  it('crée la liste « Mina — Appels & SMS » et persiste son id si absente', async () => {
    const api = fakeApi();
    const store = fakeStore();
    const sync = createCommunicationTaskSync({ taskApi: api, store });
    const id = await sync.ensureDedicatedList();
    expect(id).toBeTruthy();
    expect(await store.readTasklistId()).toBe(id);
    expect((await api.listTaskLists()).some((l) => l.title === DEDICATED_LIST_TITLE)).toBe(true);
  });

  it('retrouve une liste existante par titre EXACT', async () => {
    const api = fakeApi([{ id: 'existant', title: DEDICATED_LIST_TITLE }]);
    const sync = createCommunicationTaskSync({ taskApi: api, store: fakeStore() });
    expect(await sync.ensureDedicatedList()).toBe('existant');
  });

  it('REFUSE de fusionner automatiquement des listes homonymes', async () => {
    const api = fakeApi([{ id: 'a', title: DEDICATED_LIST_TITLE }, { id: 'b', title: DEDICATED_LIST_TITLE }]);
    const sync = createCommunicationTaskSync({ taskApi: api, store: fakeStore() });
    await expect(sync.ensureDedicatedList()).rejects.toThrow('communication_task_list_ambiguous');
  });

  it('réutilise l’id stocké s’il existe encore (aucune re-création)', async () => {
    const api = fakeApi([{ id: 'garde', title: DEDICATED_LIST_TITLE }]);
    const store = fakeStore();
    await store.writeTasklistId('garde');
    const sync = createCommunicationTaskSync({ taskApi: api, store });
    expect(await sync.ensureDedicatedList()).toBe('garde');
  });
});

describe('communication-task-sync : création + réconciliation', () => {
  it('crée une tâche formatée et NE la duplique PAS (réconciliation par Mina-ID)', async () => {
    const api = fakeApi();
    const sync = createCommunicationTaskSync({ taskApi: api, store: fakeStore() });
    const event = { kind: 'sms', eventId: 'evt_1', direction: 'inbound', numberE164: '+33612345678' };

    const first = await sync.createTaskForEvent(event, { subject: 'demande de facture', contactName: 'Ahmed' });
    expect(first.reused).toBe(false);
    const second = await sync.createTaskForEvent(event, { subject: 'demande de facture', contactName: 'Ahmed' });
    expect(second.reused).toBe(true); // même Mina-ID → réutilisée
    expect(second.taskId).toBe(first.taskId);
    expect((await api.listTasks({ tasklistId: first.tasklistId }))).toHaveLength(1);
  });
});

describe('communication-task-sync : format (§13.2)', () => {
  it('titre préfixé et notes avec Mina-ID, sans transcript ni secret', () => {
    const event = { kind: 'call', eventId: 'evt_9', state: 'missed', numberE164: '+33612341234' };
    expect(formatTaskTitle(event)).toMatch(/^\[Appel manqué\] Rappeler /u);
    const notes = formatTaskNotes(event, { phoneLabel: 'Samsung / Ligne 1', receivedAt: '29/07/2026 14:05' });
    expect(notes).toContain('Mina-ID : evt_9');
    expect(notes).toContain('Téléphone : Samsung / Ligne 1');
    expect(notes).not.toMatch(/\btranscript\b/iu);
  });
});
