// Catalogue de capacités RUNTIME (Task 8) : chaque domaine rapporte son état RÉEL au boot —
// available, degraded ou unavailable avec la raison exacte. C'est la source de vérité que l'UI
// et le diagnostic lisent ; un domaine dont la composition réelle est impossible est publié
// unavailable avec sa dépendance manquante nommée — jamais masqué, jamais simulé.

const STATUSES = new Set(['available', 'degraded', 'unavailable']);
const FORBIDDEN_EVIDENCE = /token|secret|private_key|password|passphrase/iu;

export function createRuntimeCapabilityCatalog({ clock = Date.now } = {}) {
  const entries = new Map();

  return Object.freeze({
    report({ id, status, reason = null, evidence = [] } = {}) {
      if (typeof id !== 'string' || !id) throw new TypeError('capability_id_required');
      if (!STATUSES.has(status)) throw new TypeError('capability_status_invalid');
      if (status !== 'available' && (typeof reason !== 'string' || !reason)) {
        throw new TypeError('capability_reason_required');
      }
      const safeEvidence = (Array.isArray(evidence) ? evidence : []).map((item) => String(item).slice(0, 200));
      const serialized = JSON.stringify({ reason, evidence: safeEvidence });
      if (FORBIDDEN_EVIDENCE.test(serialized)) throw new Error('capability_evidence_sensitive');
      entries.set(id, Object.freeze({
        id,
        status,
        reason,
        evidence: Object.freeze(safeEvidence),
        reportedAt: Number(clock()),
      }));
    },

    get(id) {
      return entries.get(id) ?? null;
    },

    list() {
      return Object.freeze([...entries.values()].sort((a, b) => a.id.localeCompare(b.id)));
    },

    requireAvailable(id) {
      const entry = entries.get(id);
      if (!entry || entry.status === 'unavailable') {
        throw new Error(`capability_unavailable:${id}`);
      }
      return entry;
    },
  });
}
