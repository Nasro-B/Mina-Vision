import { describe, expect, it, vi } from 'vitest';
import { createCapabilityBroker } from '../src/safety/capability-broker.mjs';

const FUTURE = '2026-07-15T01:00:00.000Z';

function createBroker({ grants, onConfirmationRequired, telegramCapabilities } = {}) {
  return createCapabilityBroker({
    clock: () => Date.parse('2026-07-15T00:00:00.000Z'),
    grants: grants ?? [{
      sessionId: 'work-1',
      capabilities: ['*'],
      resources: ['*'],
      effects: ['read', 'write', 'execute', 'send'],
      expiresAt: FUTURE,
    }],
    onConfirmationRequired,
    telegramCapabilities,
  });
}

function request(overrides = {}) {
  return {
    sessionId: 'work-1',
    channel: 'local',
    capability: 'memory.read',
    resource: 'memory:owner',
    effect: 'read',
    digest: 'sha256:request-1',
    origin: 'user',
    ...overrides,
  };
}

describe('capability broker', () => {
  it('limits SMS to reply drafts and policy-confirmed reply sends', async () => {
    const broker = createBroker();

    await expect(broker.authorize(request({
      channel: 'sms', capability: 'conversation.reply_draft', effect: 'write',
    }))).resolves.toMatchObject({ decision: 'allow' });
    await expect(broker.authorize(request({
      channel: 'sms', capability: 'conversation.reply_send', effect: 'send',
    }))).resolves.toMatchObject({ decision: 'confirm' });
    await expect(broker.authorize(request({
      channel: 'sms', capability: 'computer.click', effect: 'execute',
    }))).resolves.toMatchObject({ decision: 'deny', reason: 'channel_policy' });
  });

  it.each([
    ['conversation.reply_draft', 'write', 'allow'],
    ['memory.read', 'read', 'allow'],
    ['computer.click', 'execute', 'deny'],
    ['filesystem.read', 'read', 'deny'],
    ['skill.execute', 'execute', 'deny'],
    ['sandbox.execute', 'execute', 'deny'],
  ])('applies Telegram policy to %s', async (capability, effect, decision) => {
    const broker = createBroker();

    await expect(broker.authorize(request({ channel: 'telegram', capability, effect })))
      .resolves.toMatchObject({ decision });
  });

  it('binds confirmation to session, capability, resource and digest and consumes it once', async () => {
    const broker = createBroker();
    const sensitive = request({
      capability: 'filesystem.write',
      resource: 'C:\\Work\\report.txt',
      effect: 'write',
      digest: 'sha256:write-report',
    });

    await expect(broker.authorize(sensitive)).resolves.toMatchObject({ decision: 'confirm' });
    broker.grantConfirmation({ ...sensitive, expiresAt: FUTURE });
    await expect(broker.authorize({ ...sensitive, digest: 'sha256:other' }))
      .resolves.toMatchObject({ decision: 'confirm' });
    await expect(broker.authorize(sensitive)).resolves.toMatchObject({ decision: 'allow' });
    await expect(broker.authorize(sensitive)).resolves.toMatchObject({ decision: 'confirm' });
  });

  it('denies a hook or skill escalation without opening confirmation', async () => {
    const onConfirmationRequired = vi.fn();
    const broker = createBroker({
      grants: [{
        sessionId: 'work-1',
        capabilities: ['memory.read'],
        resources: ['memory:*'],
        effects: ['read'],
        expiresAt: FUTURE,
      }],
      onConfirmationRequired,
    });

    await expect(broker.authorize(request({
      origin: 'skill',
      capability: 'filesystem.write',
      resource: 'C:\\Windows\\System32\\config',
      effect: 'write',
    }))).resolves.toMatchObject({ decision: 'deny', reason: 'session_grant' });
    expect(onConfirmationRequired).not.toHaveBeenCalled();
  });

  it('intersects capability, effect, expiry and resource scope', async () => {
    const broker = createBroker({
      grants: [{
        sessionId: 'work-1',
        capabilities: ['filesystem.read'],
        resources: ['C:\\Work\\*'],
        effects: ['read'],
        expiresAt: FUTURE,
      }],
    });

    await expect(broker.authorize(request({
      capability: 'filesystem.read', resource: 'C:\\Work\\report.txt', effect: 'read',
    }))).resolves.toMatchObject({ decision: 'allow' });
    await expect(broker.authorize(request({
      capability: 'filesystem.read', resource: 'C:\\Secrets\\token.txt', effect: 'read',
    }))).resolves.toMatchObject({ decision: 'deny', reason: 'resource_scope' });
    await expect(broker.authorize(request({
      capability: 'filesystem.read', resource: 'C:\\Work\\report.txt', effect: 'write',
    }))).resolves.toMatchObject({ decision: 'deny', reason: 'session_grant' });
  });
});
