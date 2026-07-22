export function createAuditDiagnostics({ auditLog } = {}) {
  if (!auditLog?.listDecrypted || !auditLog?.verifyChain) throw new TypeError('audit_diagnostics_audit_log_required');

  return Object.freeze({
    // Only event TYPE, counts, and timestamps ever leave this function — never `payload` itself,
    // so memory content, secrets, or message bodies structurally cannot appear in a diagnostic.
    async buildReport({ sessionId } = {}) {
      const verdict = await auditLog.verifyChain();
      // A diagnostic must still report SOMETHING when the chain it's diagnosing is corrupted —
      // never let a decrypt failure in listDecrypted() crash the whole report; chainValid already
      // communicates the underlying problem, entryCount/typeCounts simply degrade to what's readable.
      let entries;
      try {
        entries = await auditLog.listDecrypted({ sessionId });
      } catch {
        entries = [];
      }
      const typeCounts = {};
      for (const entry of entries) {
        const type = entry.payload?.type ?? 'unknown';
        typeCounts[type] = (typeCounts[type] ?? 0) + 1;
      }
      return Object.freeze({
        sessionId: sessionId ?? null,
        entryCount: entries.length,
        typeCounts: Object.freeze(typeCounts),
        firstEventAt: entries[0]?.recordedAt ?? null,
        lastEventAt: entries.at(-1)?.recordedAt ?? null,
        chainValid: verdict.valid,
        chainIssue: verdict.valid ? null : Object.freeze({ reason: verdict.reason, sequence: verdict.sequence ?? null }),
      });
    },
  });
}
