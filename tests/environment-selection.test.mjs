import { describe, expect, it } from 'vitest';
import * as controller from '../src/ui/controller.mjs';

describe('environment selection', () => {
  it('checks exactly the requested browser, desktop or mobile radio', () => {
    expect(typeof controller.applyEnvironmentSelection).toBe('function');
    const radios = ['browser', 'desktop', 'mobile'].map((value) => ({ value, checked: value === 'browser' }));
    expect(controller.applyEnvironmentSelection('desktop', radios)).toBe('desktop');
    expect(radios.map(({ checked }) => checked)).toEqual([false, true, false]);
  });

  it('rejects an unknown environment without changing the current selection', () => {
    expect(typeof controller.applyEnvironmentSelection).toBe('function');
    const radios = ['browser', 'desktop', 'mobile'].map((value) => ({ value, checked: value === 'mobile' }));
    expect(() => controller.applyEnvironmentSelection('filesystem', radios)).toThrow('Environnement Mina invalide');
    expect(radios.map(({ checked }) => checked)).toEqual([false, false, true]);
  });
});
