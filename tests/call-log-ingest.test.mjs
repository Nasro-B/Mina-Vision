import { describe, expect, it } from 'vitest';
import { createAad, decryptAead, encryptAead } from '../src/crypto/aead.mjs';
import { createCommunicationLedger } from '../src/communications/communication-ledger.mjs';
import { createCommunicationOutbox } from '../src/communications/communication-outbox.mjs';
import { parseCallLog, createCallLogIngest } from '../src/communications/call-log-ingest.mjs';

const KEY = Buffer.alloc(32, 5);
const seal = (plaintext, { type, id }) => encryptAead({ key: KEY, plaintext, aad: createAad({ version: 1, type, id }) });
const open = (envelope, { type, id }) => decryptAead({ key: KEY, envelope, aad: createAad({ version: 1, type, id }) });

// Sortie réelle de `adb shell content query --uri content://call_log/calls`.
const SAMPLE = [
  'Row: 0 number=+33612345678, type=3, date=1690000000000, duration=0',
  'Row: 1 number=0612345679, type=1, date=1690000100000, duration=45',
  'Row: 2 number=+33698765432, type=3, date=1690000200000, duration=0',
  'Row: 3 number=15, type=3, date=1690000300000, duration=0',
].join('\n');

function setup() {
  const ledger = createCommunicationLedger({ filename: ':memory:', seal, open, now: () => 1000 });
  const outbox = createCommunicationOutbox({ now: () => 1000 });
  const ingest = createCallLogIngest({ ledger, outbox, deviceId: 'dev-huawei' });
  return { ledger, outbox, ingest };
}

describe('call-log-ingest (appel manqué → tâche)', () => {
  it('parse la sortie adb content query en entrées structurées', () => {
    const rows = parseCallLog(SAMPLE);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ number: '+33612345678', type: 3, date: 1690000000000 });
    expect(rows[1].type).toBe(1);
  });

  it('crée une tâche de rappel UNIQUEMENT pour les appels manqués (type 3), pas les entrants', () => {
    const { outbox, ingest } = setup();
    const report = ingest.ingest(parseCallLog(SAMPLE));
    // 2 manqués éligibles (+33612…, +33698…) ; l'entrant (type 1) et le numéro d'urgence « 15 » exclus.
    expect(report.missed).toBe(3);
    expect(report.tasksQueued).toBe(2);
    expect(outbox.size()).toBe(2);
  });

  it('déduplique : re-parser le même journal ne recrée pas de tâches', () => {
    const { outbox, ingest } = setup();
    ingest.ingest(parseCallLog(SAMPLE));
    const second = ingest.ingest(parseCallLog(SAMPLE));
    expect(second.tasksQueued).toBe(0);
    expect(second.deduped).toBeGreaterThan(0);
    expect(outbox.size()).toBe(2);
  });

  it('un numéro d’urgence/court manqué ne crée pas de tâche', () => {
    const { outbox, ingest } = setup();
    ingest.ingest(parseCallLog('Row: 0 number=112, type=3, date=1690000400000, duration=0'));
    expect(outbox.size()).toBe(0);
  });

  it('confidentialité : l’op outbox ne contient pas le numéro en clair', () => {
    const { outbox, ingest } = setup();
    ingest.ingest(parseCallLog('Row: 0 number=+33612345678, type=3, date=1690000500000, duration=0'));
    expect(JSON.stringify(outbox.due())).not.toContain('+33612345678');
  });
});
