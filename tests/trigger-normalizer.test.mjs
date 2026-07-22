import { describe, expect, it } from 'vitest';
import { normalizeTrigger } from '../src/automation/trigger-normalizer.mjs';

const raw = { triggerId: 't-1', type: 'schedule', occurredAt: '2026-07-16T08:00:00.000Z', payload: { actions: [] } };

describe('normalizeTrigger: canonical trigger envelope', () => {
  it('accepts a well-formed raw trigger and freezes the result', () => {
    const trigger = normalizeTrigger(raw);
    expect(trigger).toEqual(raw);
    expect(Object.isFrozen(trigger)).toBe(true);
  });

  it('defaults payload to an empty object when absent', () => {
    const { payload, ...rest } = raw;
    const trigger = normalizeTrigger(rest);
    expect(trigger.payload).toEqual({});
  });

  it('rejects a missing triggerId', () => {
    const { triggerId, ...rest } = raw;
    expect(() => normalizeTrigger(rest)).toThrow();
  });

  it('rejects a missing type', () => {
    const { type, ...rest } = raw;
    expect(() => normalizeTrigger(rest)).toThrow();
  });

  it('rejects a non-ISO occurredAt', () => {
    expect(() => normalizeTrigger({ ...raw, occurredAt: 'yesterday' })).toThrow();
  });

  it('rejects unknown extra top-level fields (strict envelope)', () => {
    expect(() => normalizeTrigger({ ...raw, unexpected: true })).toThrow();
  });
});
