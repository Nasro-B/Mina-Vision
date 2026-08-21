import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommunicationLedger } from '../src/communications/communication-ledger.mjs';
import { createCommunicationOutbox } from '../src/communications/communication-outbox.mjs';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mina-outbox-')); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* verrou WAL Windows transitoire */ } });
const file = () => join(dir, 'mina-communications.sqlite');

describe('communication-outbox durable (store SQLite du ledger, §15)', () => {
  it('une op mise en file survit à un redémarrage, avec ses tentatives', () => {
    const ledger = createCommunicationLedger({ filename: file(), now: () => 5000 });
    const outbox = createCommunicationOutbox({ now: () => 5000, store: ledger.outboxStore(), baseDelayMs: 1_000 });
    outbox.enqueue({ opId: 'op1', operation: 'create_communication_task', payload: { dedupeKey: 'dk1' }, dedupeKey: 'dk1' });
    outbox.markFailure('op1', 'network'); // attempts → 1, reporté
    ledger.close();

    const reopened = createCommunicationLedger({ filename: file(), now: () => 1_000_000 });
    const outbox2 = createCommunicationOutbox({ now: () => 1_000_000, store: reopened.outboxStore() });
    const due = outbox2.due();
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ opId: 'op1', operation: 'create_communication_task', attempts: 1 });
    expect(outbox2.markSuccess('op1')).toBe(true);
    expect(outbox2.size()).toBe(0);
    reopened.close();
  });

  it('la déduplication survit au redémarrage : la même clé ne ré-empile pas', () => {
    const ledger = createCommunicationLedger({ filename: file(), now: () => 0 });
    const outbox = createCommunicationOutbox({ store: ledger.outboxStore() });
    outbox.enqueue({ opId: 'op1', operation: 'create_communication_task', dedupeKey: 'dk1' });
    ledger.close();

    const reopened = createCommunicationLedger({ filename: file(), now: () => 0 });
    const outbox2 = createCommunicationOutbox({ store: reopened.outboxStore() });
    const returned = outbox2.enqueue({ opId: 'op2', operation: 'create_communication_task', dedupeKey: 'dk1' });
    expect(returned).toBe('op1'); // l'op persistée est réutilisée, jamais un doublon
    expect(outbox2.size()).toBe(1);
    reopened.close();
  });
});
