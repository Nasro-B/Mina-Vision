import { describe, expect, it } from 'vitest';
import { createBackpressureQueue } from '../src/core/backpressure.mjs';

describe('createBackpressureQueue: constructor guards', () => {
  it('requires a positive integer maxSize', () => {
    expect(() => createBackpressureQueue({ clock: () => 0 })).toThrow('backpressure_max_size_required');
  });

  it('requires a clock', () => {
    expect(() => createBackpressureQueue({ maxSize: 10 })).toThrow('backpressure_clock_required');
  });

  it('rejects a clock that is neither a function nor a {now()} object', () => {
    expect(() => createBackpressureQueue({ maxSize: 10, clock: {} })).toThrow('backpressure_clock_required');
  });

  it('rejects a non-integer or zero maxSize', () => {
    expect(() => createBackpressureQueue({ maxSize: 0, clock: () => 0 })).toThrow('backpressure_max_size_required');
    expect(() => createBackpressureQueue({ maxSize: 1.5, clock: () => 0 })).toThrow('backpressure_max_size_required');
  });
});

describe('createBackpressureQueue: bounded, clean rejection rather than unbounded growth', () => {
  it('accepts up to maxSize then rejects cleanly (never throws)', () => {
    const queue = createBackpressureQueue({ maxSize: 2, clock: () => 0 });
    expect(queue.enqueue('a')).toEqual({ accepted: true, size: 1 });
    expect(queue.enqueue('b')).toEqual({ accepted: true, size: 2 });
    expect(queue.enqueue('c')).toEqual({ accepted: false, reason: 'queue_full' });
    expect(queue.size()).toBe(2);
    expect(queue.rejectedCount()).toBe(1);
  });

  it('dequeues in FIFO order', () => {
    const queue = createBackpressureQueue({ maxSize: 5, clock: () => 0 });
    queue.enqueue('a');
    queue.enqueue('b');
    queue.enqueue('c');
    expect(queue.dequeue()).toBe('a');
    expect(queue.dequeue()).toBe('b');
    expect(queue.dequeue()).toBe('c');
    expect(queue.dequeue()).toBeNull();
  });
});

describe('createBackpressureQueue.pause/resume: emergency stop marks paused, never deletes the queue', () => {
  it('keeps existing items intact across a pause, but blocks new enqueues and dequeues while paused', () => {
    const queue = createBackpressureQueue({ maxSize: 5, clock: () => 0 });
    queue.enqueue('a');
    queue.enqueue('b');
    queue.pause();
    expect(queue.isPaused()).toBe(true);
    expect(queue.size()).toBe(2);
    expect(queue.enqueue('c')).toEqual({ accepted: false, reason: 'queue_paused' });
    expect(queue.dequeue()).toBeNull();
    expect(queue.size()).toBe(2);

    queue.resume();
    expect(queue.dequeue()).toBe('a');
    expect(queue.dequeue()).toBe('b');
  });
});

describe('createBackpressureQueue: storm test — 10 000 synthetic events, bounded usage, observable order and errors', () => {
  it('handles 10 000 enqueues with a small bound: memory stays bounded, order is FIFO, rejections are counted exactly', () => {
    const maxSize = 100;
    const queue = createBackpressureQueue({ maxSize, clock: () => 0 });
    let maxObservedSize = 0;
    for (let index = 0; index < 10_000; index += 1) {
      queue.enqueue(index);
      maxObservedSize = Math.max(maxObservedSize, queue.size());
    }
    expect(maxObservedSize).toBe(maxSize);
    expect(queue.size()).toBe(maxSize);
    expect(queue.rejectedCount()).toBe(10_000 - maxSize);

    const drained = [];
    let next;
    // eslint-disable-next-line no-cond-assign
    while ((next = queue.dequeue()) !== null) drained.push(next);
    expect(drained).toEqual(Array.from({ length: maxSize }, (_, index) => index));
  });
});
