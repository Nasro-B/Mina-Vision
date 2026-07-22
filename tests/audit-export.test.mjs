import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import AdmZip from 'adm-zip';
import { createAuditLog } from '../src/audit/audit-log.mjs';
import { createAuditDiagnostics } from '../src/audit/diagnostics.mjs';
import { createAuditExport } from '../src/audit/export.mjs';

const KEY = randomBytes(32);

function fakeRepository() {
  const rows = [];
  return { rows, append: vi.fn(async (row) => { rows.push(row); }), list: vi.fn(async () => [...rows]) };
}

function fakeFilesystem() {
  const files = new Map();
  return { files, writeFile: vi.fn(async (path, bytes) => files.set(path, bytes)) };
}

function buildWorld() {
  const auditLog = createAuditLog({ repository: fakeRepository(), key: KEY, sessionId: 'session-1', clock: () => 1_700_000_000_000 });
  const diagnostics = createAuditDiagnostics({ auditLog });
  const filesystem = fakeFilesystem();
  const exporter = createAuditExport({ diagnostics, filesystem, clock: () => 1_700_000_000_000 });
  return { auditLog, exporter, filesystem };
}

describe('createAuditExport: constructor guards', () => {
  it('requires diagnostics', () => {
    expect(() => createAuditExport({ filesystem: fakeFilesystem(), clock: () => 0 })).toThrow('audit_export_diagnostics_required');
  });

  it('requires a filesystem', () => {
    expect(() => createAuditExport({ diagnostics: { buildReport: vi.fn() }, clock: () => 0 })).toThrow('audit_export_filesystem_required');
  });

  it('requires a clock', () => {
    expect(() => createAuditExport({ diagnostics: { buildReport: vi.fn() }, filesystem: fakeFilesystem() })).toThrow('audit_export_clock_required');
  });

  it('rejects a clock that is neither a function nor a {now()} object', () => {
    expect(() => createAuditExport({ diagnostics: { buildReport: vi.fn() }, filesystem: fakeFilesystem(), clock: {} })).toThrow('audit_export_clock_required');
  });
});

describe('createAuditExport.exportDiagnostics: bounded, digested zip, only explicitly requested', () => {
  it('writes a real zip containing the redacted report, and returns a matching digest', async () => {
    const { auditLog, exporter, filesystem } = buildWorld();
    await auditLog.record({ type: 'send_accepted', channel: 'telegram', body: 'contenu confidentiel' });

    const result = await exporter.exportDiagnostics({ sessionId: 'session-1', destination: 'exports/diag-1.zip' });
    expect(filesystem.writeFile).toHaveBeenCalledTimes(1);

    const bytes = filesystem.files.get('exports/diag-1.zip');
    const zip = new AdmZip(bytes);
    const entry = zip.getEntries().find((candidate) => candidate.entryName === 'report.json');
    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry.getData().toString('utf8'));
    expect(parsed.entryCount).toBe(1);
    expect(JSON.stringify(parsed)).not.toContain('confidentiel');

    expect(result.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.byteSize).toBe(bytes.length);
  });

  it('rejects when the built archive would exceed maxBytes', async () => {
    const { auditLog, exporter } = buildWorld();
    await auditLog.record({ type: 'send_accepted' });
    await expect(exporter.exportDiagnostics({ sessionId: 'session-1', destination: 'exports/diag-2.zip', maxBytes: 10 }))
      .rejects.toThrow('audit_export_too_large');
  });
});
