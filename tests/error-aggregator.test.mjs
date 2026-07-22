import { describe, expect, it } from 'vitest';
import { createErrorAggregator } from '../src/diagnostics/error-aggregator.mjs';

describe('createErrorAggregator', () => {
  it('records a first occurrence with count 1 and identical first/last timestamps', () => {
    let clock = 1_000;
    const aggregator = createErrorAggregator({ clock: () => clock });
    const entry = aggregator.record({ scope: 'action:click', code: 'action_error', message: 'device offline' });
    expect(entry).toMatchObject({ scope: 'action:click', code: 'action_error', count: 1, firstAt: 1_000, lastAt: 1_000 });
  });

  it('deduplicates identical (scope, code, message) signatures into a single entry with an incrementing count', () => {
    let clock = 1_000;
    const aggregator = createErrorAggregator({ clock: () => clock });
    aggregator.record({ scope: 'action:click', code: 'action_error', message: 'device offline' });
    clock = 2_000;
    aggregator.record({ scope: 'action:click', code: 'action_error', message: 'device offline' });
    clock = 3_000;
    const third = aggregator.record({ scope: 'action:click', code: 'action_error', message: 'device offline' });

    expect(third).toMatchObject({ count: 3, firstAt: 1_000, lastAt: 3_000 });
    expect(aggregator.list()).toHaveLength(1);
  });

  it('keeps two errors with the same scope+code but different messages as separate signatures', () => {
    const aggregator = createErrorAggregator({ clock: () => 1_000 });
    aggregator.record({ scope: 'action:click', code: 'action_error', message: 'device offline' });
    aggregator.record({ scope: 'action:click', code: 'action_error', message: 'timeout' });
    expect(aggregator.list()).toHaveLength(2);
  });

  it('list() sorts by most recently seen first', () => {
    let clock = 1_000;
    const aggregator = createErrorAggregator({ clock: () => clock });
    aggregator.record({ scope: 'a', code: 'x', message: 'first' });
    clock = 2_000;
    aggregator.record({ scope: 'b', code: 'y', message: 'second' });
    const list = aggregator.list();
    expect(list.map((entry) => entry.scope)).toEqual(['b', 'a']);
  });

  it('caps the number of distinct signatures tracked, evicting the least recently seen', () => {
    const aggregator = createErrorAggregator({ clock: () => Date.now(), maxSignatures: 2 });
    aggregator.record({ scope: 'a', code: 'x', message: '1' });
    aggregator.record({ scope: 'b', code: 'x', message: '2' });
    aggregator.record({ scope: 'c', code: 'x', message: '3' });
    expect(aggregator.list()).toHaveLength(2);
    expect(aggregator.list().some((entry) => entry.scope === 'a')).toBe(false);
  });

  it('correlationId, when provided, is preserved on the entry and does not affect deduplication', () => {
    const aggregator = createErrorAggregator({ clock: () => 1_000 });
    aggregator.record({ scope: 'a', code: 'x', message: 'm', correlationId: 'corr-1' });
    const entry = aggregator.record({ scope: 'a', code: 'x', message: 'm', correlationId: 'corr-2' });
    expect(entry.count).toBe(2);
    expect(entry.lastCorrelationId).toBe('corr-2');
  });

  it('clear() empties every tracked signature', () => {
    const aggregator = createErrorAggregator({ clock: () => 1_000 });
    aggregator.record({ scope: 'a', code: 'x', message: 'm' });
    aggregator.clear();
    expect(aggregator.list()).toEqual([]);
  });

  it('redacts secret-shaped values the same way technical-log does', () => {
    const aggregator = createErrorAggregator({ clock: () => 1_000 });
    const entry = aggregator.record({ scope: 'a', code: 'x', message: 'token=abc123 failed' });
    expect(entry.message).not.toContain('abc123');
  });
});
