import { sealRecord, openRecord } from '../memory/record-codec.mjs';
import { canonicalJson } from '../crypto/canonical-json.mjs';
import { sha256 } from '../crypto/digest.mjs';

const RECORD_TYPE = 'audit-log-entry';
const GENESIS_HASH = 'genesis';

function aadId(sessionId, sequence) {
  return `${sessionId}:${sequence}`;
}

export function createAuditLog({ repository, key, sessionId, clock } = {}) {
  if (!repository?.append || !repository?.list) throw new TypeError('audit_log_repository_required');
  if (Buffer.from(key ?? []).length !== 32) throw new TypeError('audit_log_key_required');
  if (typeof sessionId !== 'string' || sessionId.length === 0) throw new TypeError('audit_log_session_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('audit_log_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  let sequence = 0;
  let previousHash = GENESIS_HASH;

  return Object.freeze({
    async record(event) {
      sequence += 1;
      const entry = {
        sequence, sessionId, previousHash,
        recordedAt: new Date(now()).toISOString(),
        payload: structuredClone(event),
      };
      const entryHash = sha256(canonicalJson(entry));
      const value = { ...entry, entryHash };
      const ciphertext = sealRecord({ key, type: RECORD_TYPE, id: aadId(sessionId, sequence), value });
      await repository.append({ sessionId, sequence, ciphertext });
      previousHash = entryHash;
      return Object.freeze({ sequence, entryHash });
    },

    // Verifies sequence continuity, hash chaining, and content integrity per session. This proves
    // nothing in what's present was reordered, gapped, or altered after the fact — it cannot alone
    // prove nothing was silently truncated off the very end of the log (a known limitation of pure
    // hash-chaining without an external, independently-anchored checkpoint).
    async verifyChain() {
      const rows = await repository.list();
      const bySession = new Map();
      for (const row of rows) {
        const state = bySession.get(row.sessionId) ?? { expectedSequence: 1, expectedPreviousHash: GENESIS_HASH };
        let decoded;
        try {
          decoded = openRecord({ key, type: RECORD_TYPE, id: aadId(row.sessionId, row.sequence), ciphertext: row.ciphertext });
        } catch {
          return Object.freeze({ valid: false, reason: 'decrypt_failed', sessionId: row.sessionId, sequence: row.sequence });
        }
        if (decoded.sequence !== state.expectedSequence) {
          return Object.freeze({
            valid: false, reason: 'sequence_gap', sessionId: row.sessionId,
            sequence: decoded.sequence, expected: state.expectedSequence,
          });
        }
        if (decoded.previousHash !== state.expectedPreviousHash) {
          return Object.freeze({ valid: false, reason: 'chain_broken', sessionId: row.sessionId, sequence: decoded.sequence });
        }
        const { entryHash: claimedHash, ...withoutHash } = decoded;
        if (sha256(canonicalJson(withoutHash)) !== claimedHash) {
          return Object.freeze({ valid: false, reason: 'entry_tampered', sessionId: row.sessionId, sequence: decoded.sequence });
        }
        bySession.set(row.sessionId, { expectedSequence: state.expectedSequence + 1, expectedPreviousHash: claimedHash });
      }
      return Object.freeze({ valid: true, entryCount: rows.length });
    },

    async listDecrypted({ sessionId: filterSessionId } = {}) {
      const rows = await repository.list();
      return rows
        .filter((row) => !filterSessionId || row.sessionId === filterSessionId)
        .map((row) => openRecord({ key, type: RECORD_TYPE, id: aadId(row.sessionId, row.sequence), ciphertext: row.ciphertext }));
    },
  });
}
