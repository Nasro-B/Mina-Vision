import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAuditLog } from '../src/audit/audit-log.mjs';

const KEY = randomBytes(32);

function fakeRepository() {
  const rows = [];
  return { rows, append: vi.fn(async (row) => { rows.push(row); }), list: vi.fn(async () => [...rows]) };
}

function buildLog(overrides = {}) {
  return createAuditLog({ repository: fakeRepository(), key: KEY, sessionId: 'session-1', clock: () => 1_700_000_000_000, ...overrides });
}

describe('createAuditLog: constructor guards', () => {
  it('requires a repository', () => {
    expect(() => createAuditLog({ key: KEY, sessionId: 's', clock: () => 0 })).toThrow('audit_log_repository_required');
  });

  it('requires a 32-byte key', () => {
    expect(() => createAuditLog({ repository: fakeRepository(), key: Buffer.alloc(16), sessionId: 's', clock: () => 0 })).toThrow('audit_log_key_required');
  });

  it('requires a sessionId', () => {
    expect(() => createAuditLog({ repository: fakeRepository(), key: KEY, clock: () => 0 })).toThrow('audit_log_session_required');
  });

  it('requires a clock', () => {
    expect(() => createAuditLog({ repository: fakeRepository(), key: KEY, sessionId: 's' })).toThrow('audit_log_clock_required');
  });

  it('rejects a clock that is neither a function nor a {now()} object', () => {
    expect(() => createAuditLog({ repository: fakeRepository(), key: KEY, sessionId: 's', clock: {} })).toThrow('audit_log_clock_required');
  });

  it('rejects a key that is entirely omitted (not just the wrong length)', () => {
    expect(() => createAuditLog({ repository: fakeRepository(), sessionId: 's', clock: () => 0 })).toThrow('audit_log_key_required');
  });

  it('accepts a {now()}-object clock, not only a bare function', async () => {
    const auditLog = createAuditLog({ repository: fakeRepository(), key: KEY, sessionId: 's', clock: { now: () => 1_700_000_000_000 } });
    const result = await auditLog.record({ type: 'a' });
    expect(result.sequence).toBe(1);
  });
});

describe('createAuditLog.record: append-only, hash-chained, encrypted', () => {
  it('never stores event content in cleartext', async () => {
    const repository = fakeRepository();
    const auditLog = createAuditLog({ repository, key: KEY, sessionId: 'session-1', clock: () => 1_700_000_000_000 });
    await auditLog.record({ type: 'send_accepted', channel: 'telegram', body: 'contenu confidentiel du message' });
    expect(JSON.stringify(repository.rows)).not.toContain('contenu confidentiel');
  });

  it('increments sequence and chains each entry to the previous entry hash', async () => {
    const auditLog = buildLog();
    const first = await auditLog.record({ type: 'auth_pairing' });
    const second = await auditLog.record({ type: 'confirmation', approved: true });
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(second.entryHash).not.toBe(first.entryHash);
  });

  it('records the mandatory event types from the plan', async () => {
    const auditLog = buildLog();
    const types = [
      'auth_pairing', 'confirmation', 'capability_deny', 'action_verification',
      'send_accepted', 'send_failed', 'forget', 'skill_install', 'skill_run', 'sandbox_job', 'backup_restore',
    ];
    for (const type of types) {
      // eslint-disable-next-line no-await-in-loop
      await expect(auditLog.record({ type })).resolves.toMatchObject({ sequence: expect.any(Number) });
    }
  });
});

describe('createAuditLog.verifyChain: detects truncation/alteration', () => {
  it('reports valid:true for an untouched chain', async () => {
    const auditLog = buildLog();
    await auditLog.record({ type: 'a' });
    await auditLog.record({ type: 'b' });
    await auditLog.record({ type: 'c' });
    const verdict = await auditLog.verifyChain();
    expect(verdict).toEqual({ valid: true, entryCount: 3 });
  });

  it('detects a middle entry removed from the repository (sequence gap)', async () => {
    const repository = fakeRepository();
    const auditLog = createAuditLog({ repository, key: KEY, sessionId: 'session-1', clock: () => 1_700_000_000_000 });
    await auditLog.record({ type: 'a' });
    await auditLog.record({ type: 'b' });
    await auditLog.record({ type: 'c' });
    repository.rows.splice(1, 1);
    const verdict = await auditLog.verifyChain();
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('sequence_gap');
  });

  it('detects a chain link broken by a re-sealed entry whose previousHash points nowhere real (self-consistent hash, wrong link)', async () => {
    const repository = fakeRepository();
    const auditLog = createAuditLog({ repository, key: KEY, sessionId: 'session-1', clock: () => 1_700_000_000_000 });
    await auditLog.record({ type: 'a' });
    await auditLog.record({ type: 'b' });
    const { canonicalJson } = await import('../src/crypto/canonical-json.mjs');
    const { sha256 } = await import('../src/crypto/digest.mjs');
    const { sealRecord } = await import('../src/memory/record-codec.mjs');
    // A forged entry #2 whose own entryHash is internally consistent (passes the tamper check) but
    // whose previousHash does not match entry #1's real hash (fails only the chain-link check).
    const forged = { sequence: 2, sessionId: 'session-1', previousHash: 'not-the-real-hash-of-entry-1', recordedAt: new Date(1_700_000_000_000).toISOString(), payload: { type: 'forged' } };
    const forgedHash = sha256(canonicalJson(forged));
    repository.rows[1].ciphertext = sealRecord({ key: KEY, type: 'audit-log-entry', id: 'session-1:2', value: { ...forged, entryHash: forgedHash } });
    const verdict = await auditLog.verifyChain();
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('chain_broken');
  });

  it('detects a decrypted-then-modified entry (tampered content, chain hash no longer matches)', async () => {
    const repository = fakeRepository();
    const auditLog = createAuditLog({ repository, key: KEY, sessionId: 'session-1', clock: () => 1_700_000_000_000 });
    await auditLog.record({ type: 'a' });
    // Simulate an attacker re-sealing a modified entry under the same key (worst case: key compromised).
    const { openRecord, sealRecord } = await import('../src/memory/record-codec.mjs');
    const decoded = openRecord({ key: KEY, type: 'audit-log-entry', id: 'session-1:1', ciphertext: repository.rows[0].ciphertext });
    const tampered = { ...decoded, payload: { ...decoded.payload, type: 'forged' } };
    repository.rows[0].ciphertext = sealRecord({ key: KEY, type: 'audit-log-entry', id: 'session-1:1', value: tampered });
    const verdict = await auditLog.verifyChain();
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('entry_tampered');
  });

  it('fails closed (decrypt_failed) when the ciphertext is corrupted outright', async () => {
    const repository = fakeRepository();
    const auditLog = createAuditLog({ repository, key: KEY, sessionId: 'session-1', clock: () => 1_700_000_000_000 });
    await auditLog.record({ type: 'a' });
    repository.rows[0].ciphertext = Buffer.from('not-a-real-envelope');
    const verdict = await auditLog.verifyChain();
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('decrypt_failed');
  });

  it('tracks independent sequence/hash chains per session', async () => {
    const repository = fakeRepository();
    const logA = createAuditLog({ repository, key: KEY, sessionId: 'session-a', clock: () => 1_700_000_000_000 });
    const logB = createAuditLog({ repository, key: KEY, sessionId: 'session-b', clock: () => 1_700_000_000_000 });
    await logA.record({ type: 'a1' });
    await logB.record({ type: 'b1' });
    await logA.record({ type: 'a2' });
    const verdict = await logA.verifyChain();
    expect(verdict.valid).toBe(true);
  });
});

describe('createAuditLog.listDecrypted: real audit review access', () => {
  it('returns decrypted entries in order, filterable by session', async () => {
    const repository = fakeRepository();
    const auditLog = createAuditLog({ repository, key: KEY, sessionId: 'session-1', clock: () => 1_700_000_000_000 });
    await auditLog.record({ type: 'auth_pairing' });
    await auditLog.record({ type: 'confirmation' });
    const entries = await auditLog.listDecrypted({ sessionId: 'session-1' });
    expect(entries.map((entry) => entry.payload.type)).toEqual(['auth_pairing', 'confirmation']);
  });
});
