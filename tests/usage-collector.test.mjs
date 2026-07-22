import { describe, expect, it, vi } from 'vitest';
import { createUsageCollector } from '../src/usage/usage-collector.mjs';

describe('usage collector', () => {
  it('queues telemetry failures without failing provider work and retries idempotently', async () => {
    const repository = { recordAttempt: vi.fn().mockRejectedValueOnce(new Error('db_busy')).mockResolvedValue(undefined) };
    const events = [];
    const collector = createUsageCollector({ repository, onEvent: (event) => events.push(event) });
    const attempt = Object.freeze({ attemptId: 'attempt-1', status: 'success' });

    await expect(collector.record(attempt)).resolves.toMatchObject({ recorded: false, pending: true });
    await expect(collector.record(attempt)).resolves.toMatchObject({ recorded: false, pending: true });
    expect(collector.pendingCount()).toBe(1);
    await expect(collector.retryPending()).resolves.toEqual({ attempted: 1, recorded: 1, remaining: 0 });

    expect(events).toContainEqual(expect.objectContaining({ type: 'usage_record_pending', attemptId: 'attempt-1' }));
    expect(repository.recordAttempt).toHaveBeenCalledTimes(2);
  });
});
