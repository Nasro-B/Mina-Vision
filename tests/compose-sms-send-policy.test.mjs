import { describe, expect, it } from 'vitest';
import { createSmsSendPolicyAccessor } from '../src/ui/runtime/compose-sms-send-policy.mjs';

describe('createSmsSendPolicyAccessor', () => {
  it('creates one lazy policy from the exact SMS configuration', () => {
    const created = [];
    const getPolicy = createSmsSendPolicyAccessor({
      getConfig: () => ({
        sms: {
          policy: {
            sendMode: 'confirm_every_send',
            allowlist: ['+33600000001'],
            quietHoursStart: 8,
            quietHoursEnd: 20,
            maxPerMinute: 3,
            maxPerDay: 20,
          },
        },
      }),
      createPolicy: (options) => {
        created.push(options);
        return { options };
      },
    });

    expect(created).toEqual([]);

    const first = getPolicy();
    const second = getPolicy();

    expect(second).toBe(first);
    expect(created).toEqual([{
      mode: 'confirm_every_send',
      allowlist: ['+33600000001'],
      quietHoursStart: 8,
      quietHoursEnd: 20,
      maxPerMinute: 3,
      maxPerDay: 20,
    }]);
  });
});
