import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { createAad, decryptAead, encryptAead } from '../src/crypto/aead.mjs';
import { normalizeSmsEvent } from '../src/communications/communication-contract.mjs';
import { createCommunicationLedger } from '../src/communications/communication-ledger.mjs';

// Clé dédiée fixe (en prod : dérivée HKDF du coffre, jamais la clé maître). seal/open câblent
// l'AEAD réel du dépôt : le test prouve le chiffrement au repos de bout en bout, pas un simulacre.
const KEY = Buffer.alloc(32, 7);
const seal = (plaintext, { type, id }) => encryptAead({ key: KEY, plaintext, aad: createAad({ version: 1, type, id }) });
const open = (envelope, { type, id }) => decryptAead({ key: KEY, envelope, aad: createAad({ version: 1, type, id }) });

const DAY = 86_400_000;
const NUMBER = '+33612345678';
const BODY = 'Peux-tu me rappeler demain a propos du devis ?';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mina-comms-')); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* verrou WAL Windows transitoire : ne masque pas l'assertion réelle */ } });
const file = () => join(dir, 'mina-communications.sqlite');

const smsEvent = (over = {}) => normalizeSmsEvent({
  deviceId: 'dev-A', messageId: 'm1', senderE164: NUMBER, body: BODY, sentAtMs: 1000, ...over,
});

describe('communication-ledger', () => {
  it('enregistre un événement + payload chiffré et les relit (roundtrip)', () => {
    const ledger = createCommunicationLedger({ filename: file(), seal, open });
    const event = smsEvent();
    const result = ledger.record(event, { numberE164: NUMBER, body: BODY });
    expect(result.deduped).toBe(false);

    const stored = ledger.get(event.dedupeKey);
    expect(stored.kind).toBe('sms');
    expect(stored.deviceId).toBe('dev-A');
    expect(stored.state).toBe('prepared');

    const payload = ledger.getPayload(event.dedupeKey);
    expect(payload.numberE164).toBe(NUMBER);
    expect(payload.body).toBe(BODY);
    ledger.close();
  });

  it('déduplique : le MÊME SMS vu en USB puis en Wi-Fi = une seule ligne (§16)', () => {
    const ledger = createCommunicationLedger({ filename: file(), seal, open });
    const first = ledger.record(smsEvent({ transport: 'usb' }), { numberE164: NUMBER, body: BODY });
    const second = ledger.record(smsEvent({ transport: 'lan' }), { numberE164: NUMBER, body: BODY });
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(ledger.count()).toBe(1);
    ledger.close();
  });

  it('fail-closed : sans clé (seal absent) un payload sensible est REFUSÉ, rien persisté', () => {
    const ledger = createCommunicationLedger({ filename: file(), seal: null, open: null });
    const event = smsEvent();
    expect(() => ledger.record(event, { numberE164: NUMBER, body: BODY }))
      .toThrow('communication_ledger_locked');
    expect(ledger.count()).toBe(0);
    ledger.close();
  });

  it('chiffré au repos : le numéro et le texte n’apparaissent JAMAIS en clair sur le disque', () => {
    const ledger = createCommunicationLedger({ filename: file(), seal, open });
    const event = smsEvent();
    ledger.record(event, { numberE164: NUMBER, body: BODY });
    ledger.close();

    // Ouverture BRUTE du fichier SQLite : preuve indépendante du module.
    const raw = new BetterSqlite3(file(), { readonly: true });
    const cells = raw.prepare('SELECT payload_cipher FROM communication_payloads').all();
    raw.close();
    const blob = JSON.stringify(cells);
    expect(blob).not.toContain(NUMBER);
    expect(blob).not.toContain('rappeler');
    expect(cells).toHaveLength(1);
  });

  it('crash et reprise : après fermeture/réouverture, rien perdu ni dupliqué (porte Phase 4)', () => {
    const ledger = createCommunicationLedger({ filename: file(), seal, open });
    const event = smsEvent();
    ledger.record(event, { numberE164: NUMBER, body: BODY });
    ledger.close();

    const reopened = createCommunicationLedger({ filename: file(), seal, open });
    expect(reopened.get(event.dedupeKey).kind).toBe('sms');
    expect(reopened.getPayload(event.dedupeKey).body).toBe(BODY);
    // Redélivrance après reprise : toujours dédupliqué, jamais une 2e ligne.
    const again = reopened.record(smsEvent({ transport: 'lan' }), { numberE164: NUMBER, body: BODY });
    expect(again.deduped).toBe(true);
    expect(reopened.count()).toBe(1);
    reopened.close();
  });

  it('les logs ordinaires exposent un digest, jamais le numéro en clair (§16)', () => {
    const ledger = createCommunicationLedger({ filename: file(), seal, open });
    const event = smsEvent();
    ledger.record(event, { numberE164: NUMBER, body: BODY });
    const stored = ledger.get(event.dedupeKey);
    expect(stored.contactDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain(NUMBER);
    ledger.close();
  });

  it('rétention : purge les événements ingérés il y a > 90 jours, garde les récents, cascade au payload', () => {
    let clock = 1 * DAY; // temps d'INGESTION contrôlé (created_at), pas le timestamp de l'événement
    const ledger = createCommunicationLedger({ filename: file(), seal, open, now: () => clock });
    const old = smsEvent({ messageId: 'old' });
    ledger.record(old, { numberE164: NUMBER, body: BODY });
    clock = 150 * DAY;
    const fresh = smsEvent({ messageId: 'fresh' });
    ledger.record(fresh, { numberE164: NUMBER, body: BODY });

    const purged = ledger.purgeExpired({ retentionDays: 90 }); // cutoff = 150j - 90j = 60j
    expect(purged.removed).toBe(1);
    expect(ledger.get(old.dedupeKey)).toBeNull();
    expect(ledger.getPayload(old.dedupeKey)).toBeNull();
    expect(ledger.get(fresh.dedupeKey).kind).toBe('sms');
    ledger.close();
  });

  it('mapping de tâche : attache et relit tasklistId/providerTaskId/etag (§15)', () => {
    const ledger = createCommunicationLedger({ filename: file(), seal, open });
    const event = smsEvent();
    ledger.record(event, { numberE164: NUMBER, body: BODY });
    ledger.attachTask(event.dedupeKey, { tasklistId: 'L1', providerTaskId: 'T1', etag: 'e1', syncState: 'synced' });
    const task = ledger.getTask(event.dedupeKey);
    expect(task).toMatchObject({ tasklistId: 'L1', providerTaskId: 'T1', etag: 'e1', syncState: 'synced' });
    ledger.close();
  });

  it('refuse un événement sans clé de déduplication', () => {
    const ledger = createCommunicationLedger({ filename: file(), seal, open });
    expect(() => ledger.record({ kind: 'sms', deviceId: 'dev-A' }, {}))
      .toThrow('communication_ledger_event_invalid');
    ledger.close();
  });
});
