import { describe, expect, it } from 'vitest';
import { toAutomationHomeResult } from '../src/home/automation-result.mjs';

describe('home automation result', () => {
  it('marks an accepted but unverified provider receipt as not executed', () => {
    expect(toAutomationHomeResult({
      state: 'accepted_by_provider',
      verified: false,
      deviceId: 'light-bedroom',
    })).toEqual({
      effect: { executed: false, verified: false },
      detail: {
        state: 'accepted_by_provider',
        verified: false,
        deviceId: 'light-bedroom',
      },
    });
  });

  it('marks only a confirmed state as executed', () => {
    expect(toAutomationHomeResult({
      state: 'state_confirmed',
      verified: true,
      deviceId: 'light-bedroom',
    })).toMatchObject({
      effect: { executed: true, verified: true },
    });
  });
});
