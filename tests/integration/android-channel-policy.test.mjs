import { describe, expect, it } from 'vitest';
import { createCapabilityBroker } from '../../src/safety/capability-broker.mjs';

const grant = {
  sessionId: 'work-android', capabilities: ['*'], resources: ['*'],
  effects: ['read', 'write', 'execute', 'send'], expiresAt: '2026-07-15T11:00:00.000Z',
};
const request = (channel, capability, effect = 'read') => ({
  sessionId: 'work-android', channel, capability, resource: '*', effect,
  digest: `sha256:${channel}-${capability}`, origin: 'user',
});

describe('Android SMS/Telegram cross-channel boundary', () => {
  it('keeps every PC, file, skill, sandbox, mail and home capability out of SMS', async () => {
    const broker = createCapabilityBroker({ clock: () => Date.parse('2026-07-15T10:00:00Z'), grants: [grant] });
    for (const capability of ['computer.click', 'filesystem.read', 'skill.execute', 'sandbox.execute', 'mail.read', 'home.read']) {
      await expect(broker.authorize(request('sms', capability))).resolves.toMatchObject({ decision: 'deny', reason: 'channel_policy' });
    }
  });

  it('adds only locally configured Telegram mail/home scopes and ignores request-supplied escalation', async () => {
    const broker = createCapabilityBroker({
      clock: () => Date.parse('2026-07-15T10:00:00Z'), grants: [grant],
      telegramCapabilities: ['mail.read', 'home.read', 'home.low_risk'],
    });
    await expect(broker.authorize(request('telegram', 'mail.read'))).resolves.toMatchObject({ decision: 'allow' });
    await expect(broker.authorize(request('telegram', 'home.low_risk', 'execute'))).resolves.toMatchObject({ decision: 'confirm' });
    await expect(broker.authorize({
      ...request('telegram', 'sandbox.execute', 'execute'), telegramCapabilities: ['sandbox.execute'],
    })).resolves.toMatchObject({ decision: 'deny', reason: 'channel_policy' });
  });
});
