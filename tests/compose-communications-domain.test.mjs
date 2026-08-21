import { describe, expect, it } from 'vitest';
import { composeCommunicationsDomain } from '../src/communications/compose-communications-domain.mjs';

const MASTER = Buffer.alloc(32, 42);

function fakeTaskApi() {
  const tasks = [];
  return {
    tasks,
    async listTaskLists() { return [{ id: 'L1', title: 'Mina — Appels & SMS' }]; },
    async insertTaskList({ title }) { return { id: 'L1', title }; },
    async listTasks() { return tasks; },
    async insertTask({ tasklistId, title, notes }) { const t = { id: `T${tasks.length + 1}`, tasklistId, title, notes }; tasks.push(t); return t; },
  };
}
const memStore = () => { let id = null; return { async readTasklistId() { return id; }, async writeTasklistId(v) { id = v; } }; };
const actionableSms = () => ({ deviceId: 'dev-A', messageId: 'm1', eventId: 'evt-1', senderE164: '+33612345678', body: 'peux-tu me rappeler', sentAtMs: 1 });

describe('compose-communications-domain (assemblage)', () => {
  it('opérationnel : ingère un SMS et draine la tâche de bout en bout', async () => {
    const domain = composeCommunicationsDomain({ masterKey: MASTER, filename: ':memory:', taskApi: fakeTaskApi(), taskStore: memStore() });
    expect(domain.state).toBe('operational');
    const ingested = domain.ingestSms(actionableSms());
    expect(ingested.task).toBe(true);
    expect(domain.status().pendingTasks).toBe(1);
    const report = await domain.drainTasks();
    expect(report).toMatchObject({ synced: 1 });
    expect(domain.status()).toMatchObject({ pendingTasks: 0, events: 1 });
    domain.close();
  });

  it('coffre verrouillé (pas de clé) : état locked, un SMS sensible est refusé (fail-closed)', () => {
    const domain = composeCommunicationsDomain({ masterKey: null, filename: ':memory:' });
    expect(domain.state).toBe('locked');
    expect(() => domain.ingestSms(actionableSms())).toThrow('communication_ledger_locked');
    domain.close();
  });

  it('Google non connecté : état degraded, l’ingestion marche mais le drain est ignoré honnêtement', async () => {
    const domain = composeCommunicationsDomain({ masterKey: MASTER, filename: ':memory:', taskApi: null });
    expect(domain.state).toBe('degraded');
    expect(domain.reason).toMatch(/google/i);
    domain.ingestSms(actionableSms());
    expect(domain.status().pendingTasks).toBe(1); // la tâche s'accumule dans l'outbox durable
    const report = await domain.drainTasks();
    expect(report).toMatchObject({ skipped: true });
    expect(domain.status().pendingTasks).toBe(1); // toujours en file, jamais perdue
    domain.close();
  });

  it('expose le routeur sortant et les politiques (assemblage complet)', () => {
    const domain = composeCommunicationsDomain({ masterKey: MASTER, filename: ':memory:', taskApi: fakeTaskApi(), taskStore: memStore() });
    domain.fleet.track({ deviceId: 'dev-A', model: 'MAR', transport: 'usb', healthy: true });
    const routed = domain.routeOutbound({ deviceId: 'dev-A', subscriptionId: 'sim-1', toE164: '+33698765432', body: 'ok' });
    expect(routed.deviceId).toBe('dev-A');
    expect(typeof domain.incomingPolicy.evaluateIncomingCall).toBe('function');
    expect(typeof domain.callPolicy.guardMinaAct).toBe('function');
    expect(typeof domain.hfpAdapter.lockForCall).toBe('function');
    domain.close();
  });
});
