import { describe, expect, it } from 'vitest';
import { createAad, decryptAead, encryptAead } from '../src/crypto/aead.mjs';
import { createCommunicationLedger } from '../src/communications/communication-ledger.mjs';
import { createCommunicationOutbox } from '../src/communications/communication-outbox.mjs';
import { createSmsTaskIngest } from '../src/communications/sms-task-ingest.mjs';

const KEY = Buffer.alloc(32, 9);
const seal = (plaintext, { type, id }) => encryptAead({ key: KEY, plaintext, aad: createAad({ version: 1, type, id }) });
const open = (envelope, { type, id }) => decryptAead({ key: KEY, envelope, aad: createAad({ version: 1, type, id }) });

const NUMBER = '+33698765432';
function setup({ locked = false } = {}) {
  const ledger = createCommunicationLedger({ filename: ':memory:', seal: locked ? null : seal, open: locked ? null : open, now: () => 1000 });
  const outbox = createCommunicationOutbox({ now: () => 1000 });
  const ingest = createSmsTaskIngest({ ledger, outbox });
  return { ledger, outbox, ingest };
}
const sms = (over = {}) => ({ deviceId: 'dev-A', messageId: 'm1', senderE164: NUMBER, sentAtMs: 1, ...over });

describe('sms-task-ingest (Phase 8, dormant)', () => {
  it('un SMS actionnable est enregistré ET met une op de tâche différée dans l’outbox', () => {
    const { ledger, outbox, ingest } = setup();
    const result = ingest.ingest(sms({ body: 'Peux-tu me rappeler pour le rendez-vous ?' }));
    expect(result).toMatchObject({ recorded: true, task: true, category: 'actionable' });
    expect(outbox.size()).toBe(1);
    const [op] = outbox.due();
    expect(op.operation).toBe('create_communication_task');
    expect(ledger.getTask(result.dedupeKey).syncState).toBe('queued');
  });

  it('un OTP / une pub / une alerte bancaire est enregistré SANS créer de tâche (§12.3)', () => {
    for (const body of ['Votre code de verification est 483920', 'PROMO -50% abonnez-vous', 'Prelevement de 90 EUR sur votre carte bancaire']) {
      const { outbox, ingest } = setup();
      const result = ingest.ingest(sms({ body }));
      expect(result.task).toBe(false);
      expect(outbox.size()).toBe(0);
    }
  });

  it('déduplique : le même SMS (USB puis Wi-Fi) = une ligne, une seule tâche', () => {
    const { ledger, outbox, ingest } = setup();
    const first = ingest.ingest(sms({ body: 'rappelle moi stp', transport: 'usb' }));
    const second = ingest.ingest(sms({ body: 'rappelle moi stp', transport: 'lan' }));
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(ledger.count()).toBe(1);
    expect(outbox.size()).toBe(1);
  });

  it('confidentialité : l’op outbox ne contient NI le numéro NI le texte (§16)', () => {
    const { outbox, ingest } = setup();
    ingest.ingest(sms({ body: 'peux-tu me rappeler demain' }));
    const blob = JSON.stringify(outbox.due());
    expect(blob).not.toContain(NUMBER);
    expect(blob).not.toContain('rappeler');
  });

  it('forcé (« transformer en tâche ») crée une tâche même sur un message non actionnable', () => {
    const { outbox, ingest } = setup();
    const result = ingest.ingest(sms({ body: 'PROMO -50%', forceTask: true }));
    expect(result.task).toBe(true);
    expect(result.category).toBe('forced');
    expect(outbox.size()).toBe(1);
  });

  it('fail-closed : coffre verrouillé + SMS avec texte → refusé, rien enfilé', () => {
    const { outbox, ingest } = setup({ locked: true });
    expect(() => ingest.ingest(sms({ body: 'rappelle moi' }))).toThrow('communication_ledger_locked');
    expect(outbox.size()).toBe(0);
  });
});
