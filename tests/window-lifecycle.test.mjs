import { describe, expect, it, vi } from 'vitest';
import { loadAndShowWindow } from '../src/ui/window-lifecycle.mjs';

describe('loadAndShowWindow', () => {
  it('registers ready-to-show before loading the document', async () => {
    const order = [];
    let ready;
    const window = {
      once: vi.fn((event, callback) => { order.push(event); ready = callback; }),
      loadFile: vi.fn(async () => { order.push('loadFile'); ready(); }),
      show: vi.fn(() => order.push('show')),
    };

    await loadAndShowWindow(window, 'index.html');

    expect(order).toEqual(['ready-to-show', 'loadFile', 'show']);
  });
});
