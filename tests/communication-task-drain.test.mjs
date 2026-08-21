import { describe, expect, it } from 'vitest';
import { createAad, decryptAead, encryptAead } from '../src/crypto/aead.mjs';
import { createCommunicationLedger } from '../src/communications/communication-ledger.mjs';
import { createCommunicationOutbox } from '../src/communications/communication-outbox.mjs';
import { createSmsTaskIngest } from '../src/communications/sms-task-ingest.mjs';
import { createCommunicationTaskSync } from '../src/personal/communication-task-sync.mjs';
import { createCommunicationTaskDrain } from '../src/communications/communication-task-drain.mjs';

const KEY = Buffer.alloc(32, 3);
const seal = (plaintext, { type, id }) => encryptAead({ key: KEY, plaintext, aad: createAad({ version: 1, type, id }) });
const open = (envelope, { type, id }) => decryptAead({ key: KEY, envelope, aad: createAad({ version: 1, type, id }) });

function fakeTaskApi({ failInsert = false } = {}) {
  const tasks = [];
  return {
    tasks,
    calls: { insertTask: 0 },
    async listTaskLists() { return [{ id: 'L1', title: 'Mina — Appels & SMS' }]; },
    async insertTaskList({ title }) { return { id: 'L1', title }; },
    async listTasks() { return tasks; },
    async insertTask({ tasklistId, title, notes }) {
      this.calls.insertTask += 1;
      if (failInsert) throw new Error('google_unreachable');
      const task = { id: `T${tasks.length + 1}`, tasklistId, title, notes };
      tasks.push(task);
      return task;
    },
  };
}
const memStore = () => { let id = null; return { async readTasklistId() { return id; }, async writeTasklistId(v) { id = v; } }; };

function setup({ failInsert = false } = {}) {
  const ledger = createCommunicationLedger({ filename: ':memory:', seal, open, now: () => 1000 });
  const outbox = createCommunicationOutbox({ now: () => 1000 });
  const ingest = createSmsTaskIngest({ ledger, outbox });
  const taskApi = fakeTaskApi({ failInsert });
  const taskSync = createCommunicationTaskSync({ taskApi, store: memStore(), outbox: null });
  const drain = createCommunicationTaskDrain({ ledger, outbox, taskSync });
  return { ledger, outbox, ingest, taskApi, drain };
}
const actionableSms = (over = {}) => ({ deviceId: 'dev-A', messageId: 'm1', eventId: 'evt-1', senderE164: '+33612345678', body: 'peux-tu me rappeler', sentAtMs: 1, ...over });

describe('communication-task-drain (Phase 9, logique testée offline)', () => {
  it('draine une op en file → tâche Google créée, outbox vidée, ledger synced', async () => {
    const { ingest, outbox, taskApi, drain, ledger } = setup();
    const { dedupeKey } = ingest.ingest(actionableSms());
    expect(outbox.size()).toBe(1);

    const report = await drain.drainOnce();
    expect(report).toMatchObject({ processed: 1, synced: 1, failed: 0 });
    expect(taskApi.calls.insertTask).toBe(1);
    expect(outbox.size()).toBe(0);
    expect(ledger.getTask(dedupeKey)).toMatchObject({ syncState: 'synced', providerTaskId: 'T1' });
  });

  it('le titre de la tâche ne contient qu’un numéro MASQUÉ, jamais le numéro complet ni le texte (§13.2)', async () => {
    const { ingest, taskApi, drain } = setup();
    ingest.ingest(actionableSms());
    await drain.drainOnce();
    expect(taskApi.tasks).toHaveLength(1);
    const blob = JSON.stringify(taskApi.tasks);
    expect(blob).not.toContain('+33612345678'); // numéro complet jamais exposé
    expect(blob).not.toContain('peux-tu me rappeler'); // texte du SMS jamais recopié
    expect(blob).toContain('••••'); // forme masquée présente
  });

  it('échec Google → outbox garde l’op (retry), ledger non synced', async () => {
    const { ingest, outbox, drain, ledger } = setup({ failInsert: true });
    const { dedupeKey } = ingest.ingest(actionableSms());
    const report = await drain.drainOnce();
    expect(report).toMatchObject({ processed: 1, synced: 0, failed: 1 });
    expect(outbox.size()).toBe(1); // reste en file pour rejeu
    expect(ledger.getTask(dedupeKey).syncState).not.toBe('synced');
  });

  it('idempotent : une 2e passe ne recrée pas la tâche (dédup outbox déjà vidée)', async () => {
    const { ingest, taskApi, drain } = setup();
    ingest.ingest(actionableSms());
    await drain.drainOnce();
    await drain.drainOnce(); // rien de dû
    expect(taskApi.calls.insertTask).toBe(1);
  });

  it('op orpheline (dedupeKey absent du ledger) est abandonnée sans planter', async () => {
    const { outbox, drain } = setup();
    outbox.enqueue({ opId: 'task-orphan', operation: 'create_communication_task', payload: { dedupeKey: 'inexistant' }, dedupeKey: 'inexistant' });
    const report = await drain.drainOnce();
    expect(report.dropped).toBe(1);
    expect(outbox.size()).toBe(0);
  });
});
