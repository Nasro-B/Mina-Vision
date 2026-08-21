import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { createCommunicationLedger } from '../src/communications/communication-ledger.mjs';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mina-calls-')); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* verrou WAL Windows transitoire */ } });
const file = () => join(dir, 'mina-communications.sqlite');

describe('communication-ledger call_sessions (§15)', () => {
  it('ouvre une session d’appel puis suit son cycle de vie (état/consentement/média/erreur)', () => {
    const ledger = createCommunicationLedger({ filename: file(), now: () => 1000 });
    ledger.openCallSession({ callId: 'call-1', deviceId: 'dev-A', dedupeKey: 'dk1' });
    expect(ledger.getCallSession('call-1')).toMatchObject({ callId: 'call-1', deviceId: 'dev-A', state: 'detected' });

    ledger.updateCallSession('call-1', { state: 'disclosure' });
    ledger.updateCallSession('call-1', { state: 'consent', consent: 'granted', media: 'hfp:dev-A' });
    ledger.updateCallSession('call-1', { state: 'media_failed', error: 'sco_link_lost' });
    const session = ledger.getCallSession('call-1');
    expect(session).toMatchObject({ state: 'media_failed', consent: 'granted', media: 'hfp:dev-A', error: 'sco_link_lost' });
    ledger.close();
  });

  it('ouverture idempotente : re-ouvrir le même callId renvoie l’existant, jamais un doublon', () => {
    const ledger = createCommunicationLedger({ filename: file(), now: () => 1000 });
    ledger.openCallSession({ callId: 'call-1', deviceId: 'dev-A' });
    ledger.updateCallSession('call-1', { state: 'answering' });
    const again = ledger.openCallSession({ callId: 'call-1', deviceId: 'dev-A' });
    expect(again.state).toBe('answering'); // pas réinitialisé à 'detected'
    ledger.close();
  });

  it('AUCUN audio n’est persistable : la table n’a aucune colonne audio (§15.1)', () => {
    const ledger = createCommunicationLedger({ filename: file(), now: () => 1000 });
    ledger.openCallSession({ callId: 'call-1', deviceId: 'dev-A' });
    ledger.close();
    const raw = new BetterSqlite3(file(), { readonly: true });
    const columns = raw.prepare('PRAGMA table_info(call_sessions)').all().map((c) => c.name);
    raw.close();
    expect(columns.some((name) => /audio|pcm|waveform|sample/iu.test(name))).toBe(false);
  });

  it('crash et reprise : la session survit à une fermeture/réouverture', () => {
    const ledger = createCommunicationLedger({ filename: file(), now: () => 1000 });
    ledger.openCallSession({ callId: 'call-1', deviceId: 'dev-A' });
    ledger.updateCallSession('call-1', { state: 'confirmed' });
    ledger.close();
    const reopened = createCommunicationLedger({ filename: file(), now: () => 1000 });
    expect(reopened.getCallSession('call-1').state).toBe('confirmed');
    reopened.close();
  });

  it('rétention : les sessions ingérées il y a > 90 jours sont purgées', () => {
    let clock = 1 * 86_400_000;
    const ledger = createCommunicationLedger({ filename: file(), now: () => clock });
    ledger.openCallSession({ callId: 'old', deviceId: 'dev-A' });
    clock = 150 * 86_400_000;
    ledger.openCallSession({ callId: 'fresh', deviceId: 'dev-A' });
    ledger.purgeExpired({ retentionDays: 90 });
    expect(ledger.getCallSession('old')).toBeNull();
    expect(ledger.getCallSession('fresh').state).toBe('detected');
    ledger.close();
  });
});
