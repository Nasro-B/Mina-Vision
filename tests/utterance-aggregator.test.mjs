import { describe, expect, it, vi } from 'vitest';
import { createUtteranceAggregator } from '../src/voice/utterance-aggregator.mjs';

// Deterministic scheduler: captures the pending flush so tests fire it explicitly, no real timers.
function manualScheduler() {
  let pending = null;
  return {
    schedule: (fn) => { pending = fn; return Symbol('timer'); },
    cancel: () => { pending = null; },
    fire: () => { const fn = pending; pending = null; if (fn) fn(); },
    hasPending: () => pending !== null,
  };
}

describe('utterance aggregator', () => {
  it('joins partial transcript fragments into one utterance on silence flush', () => {
    const clock = manualScheduler();
    const heard = [];
    const aggregator = createUtteranceAggregator({
      schedule: clock.schedule, cancel: clock.cancel, onUtterance: (text) => heard.push(text),
    });
    aggregator.push('active');
    aggregator.push(' la caméra');
    expect(heard).toEqual([]);
    clock.fire();
    expect(heard).toEqual(['active la caméra']);
  });

  it('restarts the silence window on every fragment so mid-sentence pauses never split an utterance', () => {
    const clock = manualScheduler();
    const heard = [];
    const aggregator = createUtteranceAggregator({
      schedule: clock.schedule, cancel: clock.cancel, onUtterance: (text) => heard.push(text),
    });
    aggregator.push("d'accord tu peux lancer");
    aggregator.push(' la cam');
    clock.fire();
    expect(heard).toEqual(["d'accord tu peux lancer la cam"]);
  });

  it('emits separate utterances across two silence windows and resets its buffer between them', () => {
    const clock = manualScheduler();
    const heard = [];
    const aggregator = createUtteranceAggregator({
      schedule: clock.schedule, cancel: clock.cancel, onUtterance: (text) => heard.push(text),
    });
    aggregator.push('oui');
    clock.fire();
    aggregator.push('mets de la musique');
    clock.fire();
    expect(heard).toEqual(['oui', 'mets de la musique']);
  });

  it('collapses whitespace runs and trims the flushed utterance', () => {
    const clock = manualScheduler();
    const heard = [];
    const aggregator = createUtteranceAggregator({
      schedule: clock.schedule, cancel: clock.cancel, onUtterance: (text) => heard.push(text),
    });
    aggregator.push('  inverse ');
    aggregator.push('  la caméra  ');
    clock.fire();
    expect(heard).toEqual(['inverse la caméra']);
  });

  it('ignores empty and whitespace-only fragments without arming a flush', () => {
    const clock = manualScheduler();
    const heard = [];
    const aggregator = createUtteranceAggregator({
      schedule: clock.schedule, cancel: clock.cancel, onUtterance: (text) => heard.push(text),
    });
    aggregator.push('');
    aggregator.push('   ');
    aggregator.push(null);
    expect(clock.hasPending()).toBe(false);
    clock.fire();
    expect(heard).toEqual([]);
  });

  it('flush() forces the pending utterance out immediately (session close)', () => {
    const clock = manualScheduler();
    const heard = [];
    const aggregator = createUtteranceAggregator({
      schedule: clock.schedule, cancel: clock.cancel, onUtterance: (text) => heard.push(text),
    });
    aggregator.push('mina arrête');
    aggregator.flush();
    expect(heard).toEqual(['mina arrête']);
    clock.fire();
    expect(heard).toEqual(['mina arrête']);
  });

  it('caps a runaway buffer instead of growing without bound', () => {
    const clock = manualScheduler();
    const heard = [];
    const aggregator = createUtteranceAggregator({
      maxChars: 50, schedule: clock.schedule, cancel: clock.cancel, onUtterance: (text) => heard.push(text),
    });
    aggregator.push('a'.repeat(80));
    clock.fire();
    expect(heard).toHaveLength(1);
    expect(heard[0].length).toBeLessThanOrEqual(50);
  });

  it('passes the configured hold delay to the scheduler', () => {
    const schedule = vi.fn(() => Symbol('t'));
    const aggregator = createUtteranceAggregator({ holdMs: 1234, schedule, cancel: () => {}, onUtterance: () => {} });
    aggregator.push('bonjour');
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 1234);
  });
});
