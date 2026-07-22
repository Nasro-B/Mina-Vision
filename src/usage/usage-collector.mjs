export function createUsageCollector({ repository, onEvent = () => {} } = {}) {
  if (!repository?.recordAttempt) throw new TypeError('usage_repository_required');
  const pending = new Map();

  async function record(attempt) {
    if (!attempt?.attemptId) throw new TypeError('usage_attempt_id_required');
    if (pending.has(attempt.attemptId)) return Object.freeze({ recorded: false, pending: true });
    try {
      await repository.recordAttempt(attempt);
      return Object.freeze({ recorded: true, pending: false });
    } catch (error) {
      pending.set(attempt.attemptId, attempt);
      onEvent(Object.freeze({
        type: 'usage_record_pending',
        attemptId: attempt.attemptId,
        error: String(error?.message || error).slice(0, 200),
      }));
      return Object.freeze({ recorded: false, pending: true });
    }
  }

  async function retryPending() {
    let recorded = 0;
    const values = [...pending.values()];
    for (const attempt of values) {
      try {
        await repository.recordAttempt(attempt);
        pending.delete(attempt.attemptId);
        recorded += 1;
      } catch {
        // Remains pending for a later bounded retry.
      }
    }
    return Object.freeze({ attempted: values.length, recorded, remaining: pending.size });
  }

  return Object.freeze({ record, retryPending, pendingCount: () => pending.size });
}
