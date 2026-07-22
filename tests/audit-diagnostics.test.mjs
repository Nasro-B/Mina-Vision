import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAuditLog } from '../src/audit/audit-log.mjs';
import { createAuditDiagnostics } from '../src/audit/diagnostics.mjs';

const KEY = randomBytes(32);

function fakeRepository() {
  const rows = [];
  return { rows, append: vi.fn(async (row) => { rows.push(row); }), list: vi.fn(async () => [...rows]) };
}

function buildAuditLog() {
  return createAuditLog({ repository: fakeRepository(), key: KEY, sessionId: 'session-1', clock: () => 1_700_000_000_000 });
}

describe('createAuditDiagnostics: constructor guards', () => {
  it('requires an auditLog', () => {
    expect(() => createAuditDiagnostics({})).toThrow('audit_diagnostics_audit_log_required');
  });
});

describe('createAuditDiagnostics.buildReport: redacted counts only, never memory/secret/body content', () => {
  it('summarizes type counts and chain validity without ever including payload content', async () => {
    const auditLog = buildAuditLog();
    await auditLog.record({ type: 'send_accepted', channel: 'telegram', body: 'contenu confidentiel' });
    await auditLog.record({ type: 'send_accepted', channel: 'sms', body: 'secret 12345' });
    await auditLog.record({ type: 'capability_deny', capability: 'home.execute' });

    const diagnostics = createAuditDiagnostics({ auditLog });
    const report = await diagnostics.buildReport({ sessionId: 'session-1' });

    expect(report.entryCount).toBe(3);
    expect(report.typeCounts).toEqual({ send_accepted: 2, capability_deny: 1 });
    expect(report.chainValid).toBe(true);
    expect(JSON.stringify(report)).not.toContain('confidentiel');
    expect(JSON.stringify(report)).not.toContain('secret 12345');
  });

  it('reports chainValid:false when the underlying chain is tampered', async () => {
    const repository = fakeRepository();
    const auditLog = createAuditLog({ repository, key: KEY, sessionId: 'session-1', clock: () => 1_700_000_000_000 });
    await auditLog.record({ type: 'a' });
    repository.rows[0].ciphertext = Buffer.from('corrupted');
    const diagnostics = createAuditDiagnostics({ auditLog });
    const report = await diagnostics.buildReport({ sessionId: 'session-1' });
    expect(report.chainValid).toBe(false);
  });

  it('reports firstEventAt/lastEventAt spanning the recorded entries', async () => {
    let clockValue = 1_700_000_000_000;
    const repository = fakeRepository();
    const auditLog = createAuditLog({ repository, key: KEY, sessionId: 'session-1', clock: () => clockValue });
    await auditLog.record({ type: 'a' });
    clockValue += 60_000;
    await auditLog.record({ type: 'b' });
    const diagnostics = createAuditDiagnostics({ auditLog });
    const report = await diagnostics.buildReport({ sessionId: 'session-1' });
    expect(report.firstEventAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(report.lastEventAt).toBe(new Date(1_700_000_060_000).toISOString());
  });

  it('buckets an event with no type field under "unknown" rather than dropping or crashing', async () => {
    const auditLog = buildAuditLog();
    await auditLog.record({});
    const diagnostics = createAuditDiagnostics({ auditLog });
    const report = await diagnostics.buildReport({ sessionId: 'session-1' });
    expect(report.typeCounts).toEqual({ unknown: 1 });
  });

  it('reports sessionId:null when no sessionId filter is passed', async () => {
    const auditLog = buildAuditLog();
    await auditLog.record({ type: 'a' });
    const diagnostics = createAuditDiagnostics({ auditLog });
    const report = await diagnostics.buildReport();
    expect(report.sessionId).toBeNull();
  });

  it('falls back to sequence:null in chainIssue if the underlying verifyChain omits it', async () => {
    const auditLog = { listDecrypted: vi.fn(async () => []), verifyChain: vi.fn(async () => ({ valid: false, reason: 'unknown_failure' })) };
    const diagnostics = createAuditDiagnostics({ auditLog });
    const report = await diagnostics.buildReport({ sessionId: 'session-1' });
    expect(report.chainIssue).toEqual({ reason: 'unknown_failure', sequence: null });
  });
});
