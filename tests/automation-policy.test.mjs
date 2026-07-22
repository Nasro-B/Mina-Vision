import { describe, expect, it, vi } from 'vitest';
import { createAutomationPolicy } from '../src/automation/automation-policy.mjs';

const DIGEST = 'a'.repeat(64);

const shadowDef = Object.freeze({ automationId: 'def-1', status: 'shadow', version: 1 });
const draftDef = Object.freeze({ automationId: 'def-1', status: 'draft', version: 1 });
const suspendedDef = Object.freeze({ automationId: 'def-1', status: 'suspended', version: 1 });
const revokedDef = Object.freeze({ automationId: 'def-1', status: 'revoked', version: 1 });
const supervisedDef = Object.freeze({ automationId: 'def-1', status: 'supervised', version: 1 });
const activeDef = Object.freeze({ automationId: 'def-1', status: 'active', version: 1 });

function validGrant(overrides = {}) {
  return Object.freeze({
    grantId: 'grant-1',
    automationId: 'def-1',
    digest: DIGEST,
    expiresAt: '2026-08-01T00:00:00.000Z',
    resourceScope: ['telegram:send_message'],
    channelScope: ['telegram'],
    schedule: null,
    maxRiskLevel: 3,
    maxFrequencyPerWindow: 5,
    maxCostMicros: 1_000_000,
    maxDurationMs: 5000,
    ...overrides,
  });
}

function validSimulation(overrides = {}) {
  return Object.freeze({
    simulationId: 'sim-1',
    digest: DIGEST,
    proposedActions: [{ actionType: 'notify', capability: 'telegram:send_message', effect: 'send' }],
    estimatedUsage: { estimatedCostMicros: 500, estimatedDurationMs: 1000 },
    ...overrides,
  });
}

const trigger = Object.freeze({ triggerId: 't-1', type: 'schedule', occurredAt: '2026-07-16T10:00:00.000Z', payload: {} });

function baseContext(overrides = {}) {
  return { channel: 'telegram', riskLevel: 1, recentRunCount: 0, ...overrides };
}

function allowingBroker() {
  return { authorize: vi.fn(async () => ({ decision: 'allow', reason: 'authorized' })) };
}

function allowingBudgetGuard() {
  return { snapshot: vi.fn(async () => ({ remainingMicros: 1_000_000, overBudget: false })) };
}

const clock = () => Date.parse('2026-07-16T10:00:00.000Z');

function makePolicy(overrides = {}) {
  return createAutomationPolicy({
    capabilityBroker: allowingBroker(),
    budgetGuard: allowingBudgetGuard(),
    clock,
    ...overrides,
  });
}

describe('createAutomationPolicy: constructor guards', () => {
  it('requires a capabilityBroker', () => {
    expect(() => createAutomationPolicy({ budgetGuard: allowingBudgetGuard(), clock })).toThrow('automation_policy_capability_broker_required');
  });

  it('requires a budgetGuard', () => {
    expect(() => createAutomationPolicy({ capabilityBroker: allowingBroker(), clock })).toThrow('automation_policy_budget_guard_required');
  });
});

describe('createAutomationPolicy.evaluate: status short-circuits', () => {
  it('returns simulate for a shadow-mode definition without requiring a grant', async () => {
    const policy = makePolicy();
    const decision = await policy.evaluate({ definition: shadowDef, grant: null, trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'simulate', reasons: ['shadow_mode'] });
  });

  it('denies a draft definition', async () => {
    const policy = makePolicy();
    const decision = await policy.evaluate({ definition: draftDef, grant: validGrant(), trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'deny', reasons: ['automation_draft'] });
  });

  it('denies a suspended definition', async () => {
    const policy = makePolicy();
    const decision = await policy.evaluate({ definition: suspendedDef, grant: validGrant(), trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'deny', reasons: ['automation_suspended'] });
  });

  it('denies a revoked definition', async () => {
    const policy = makePolicy();
    const decision = await policy.evaluate({ definition: revokedDef, grant: validGrant(), trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'deny', reasons: ['automation_revoked'] });
  });
});

describe('createAutomationPolicy.evaluate: grant existence and expiry', () => {
  it('denies an expired grant even when capability broker allows', async () => {
    const policy = makePolicy();
    const expiredGrant = validGrant({ expiresAt: '2020-01-01T00:00:00.000Z' });
    const decision = await policy.evaluate({ definition: activeDef, grant: expiredGrant, trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual(expect.objectContaining({ decision: 'deny', reasons: ['grant_expired'] }));
  });

  it('denies when no grant is provided at all for an active definition', async () => {
    const policy = makePolicy();
    const decision = await policy.evaluate({ definition: activeDef, grant: null, trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'deny', reasons: ['grant_expired'] });
  });
});

describe('createAutomationPolicy.evaluate: grant-limit dimensions (most-restrictive-wins, fail closed)', () => {
  it('denies on digest mismatch between grant and simulation', async () => {
    const policy = makePolicy();
    const grant = validGrant({ digest: 'b'.repeat(64) });
    const decision = await policy.evaluate({ definition: activeDef, grant, trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'deny', reasons: ['digest_mismatch'] });
  });

  it('denies when a proposed action capability is outside the grant resourceScope', async () => {
    const policy = makePolicy();
    const grant = validGrant({ resourceScope: ['home:set_light_state'] });
    const decision = await policy.evaluate({ definition: activeDef, grant, trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'deny', reasons: ['resource_not_permitted'] });
  });

  it('denies when the context channel is outside the grant channelScope', async () => {
    const policy = makePolicy();
    const grant = validGrant({ channelScope: ['sms'] });
    const decision = await policy.evaluate({ definition: activeDef, grant, trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'deny', reasons: ['channel_not_permitted'] });
  });

  it('denies when the trigger fires outside the grant schedule window', async () => {
    const policy = makePolicy();
    const grant = validGrant({ schedule: { allowedDays: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 } });
    const nightTrigger = { ...trigger, occurredAt: '2026-07-16T23:00:00.000Z' };
    const decision = await policy.evaluate({ definition: activeDef, grant, trigger: nightTrigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'deny', reasons: ['outside_schedule'] });
  });

  it('allows when the trigger fires inside the grant schedule window', async () => {
    const policy = makePolicy();
    const grant = validGrant({ schedule: { allowedDays: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 } });
    const decision = await policy.evaluate({ definition: activeDef, grant, trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision.decision).toBe('allow');
  });

  it('denies when context.riskLevel exceeds the grant maxRiskLevel', async () => {
    const policy = makePolicy();
    const grant = validGrant({ maxRiskLevel: 1 });
    const decision = await policy.evaluate({ definition: activeDef, grant, trigger, simulation: validSimulation(), context: baseContext({ riskLevel: 5 }) });
    expect(decision).toEqual({ decision: 'deny', reasons: ['risk_exceeded'] });
  });

  it('denies when context.recentRunCount reaches the grant maxFrequencyPerWindow', async () => {
    const policy = makePolicy();
    const grant = validGrant({ maxFrequencyPerWindow: 3 });
    const decision = await policy.evaluate({ definition: activeDef, grant, trigger, simulation: validSimulation(), context: baseContext({ recentRunCount: 3 }) });
    expect(decision).toEqual({ decision: 'deny', reasons: ['frequency_exceeded'] });
  });

  it('denies when the simulation estimated cost exceeds the grant maxCostMicros', async () => {
    const policy = makePolicy();
    const grant = validGrant({ maxCostMicros: 100 });
    const decision = await policy.evaluate({ definition: activeDef, grant, trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'deny', reasons: ['cost_exceeded'] });
  });

  it('denies when budgetGuard reports insufficient remaining budget even under the grant cap', async () => {
    const budgetGuard = { snapshot: vi.fn(async () => ({ remainingMicros: 100, overBudget: false })) };
    const policy = makePolicy({ budgetGuard });
    const decision = await policy.evaluate({ definition: activeDef, grant: validGrant(), trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'deny', reasons: ['cost_exceeded'] });
  });

  it('denies when the simulation estimated duration exceeds the grant maxDurationMs', async () => {
    const policy = makePolicy();
    const grant = validGrant({ maxDurationMs: 100 });
    const decision = await policy.evaluate({ definition: activeDef, grant, trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'deny', reasons: ['duration_exceeded'] });
  });
});

describe('createAutomationPolicy.evaluate: capability broker integration', () => {
  it('denies when the capability broker denies, surfacing its reason', async () => {
    const capabilityBroker = { authorize: vi.fn(async () => ({ decision: 'deny', reason: 'resource_scope' })) };
    const policy = makePolicy({ capabilityBroker });
    const decision = await policy.evaluate({ definition: activeDef, grant: validGrant(), trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'deny', reasons: ['resource_scope'] });
  });

  it('forces confirm when the capability broker requires confirmation even for an active definition', async () => {
    const capabilityBroker = { authorize: vi.fn(async () => ({ decision: 'confirm', reason: 'confirmation_required' })) };
    const policy = makePolicy({ capabilityBroker });
    const decision = await policy.evaluate({ definition: activeDef, grant: validGrant(), trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'confirm', reasons: ['confirmation_required'] });
  });
});

describe('createAutomationPolicy.evaluate: terminal allow/confirm decisions', () => {
  it('returns confirm for a supervised definition once every limit check passes', async () => {
    const policy = makePolicy();
    const decision = await policy.evaluate({ definition: supervisedDef, grant: validGrant(), trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'confirm', reasons: ['supervised_mode'] });
  });

  it('returns allow for an active definition once every limit check passes', async () => {
    const policy = makePolicy();
    const decision = await policy.evaluate({ definition: activeDef, grant: validGrant(), trigger, simulation: validSimulation(), context: baseContext() });
    expect(decision).toEqual({ decision: 'allow', reasons: [] });
  });

  it('never widens resourceScope or channelScope regardless of context', async () => {
    const policy = makePolicy();
    const grant = validGrant({ resourceScope: ['telegram:send_message'], channelScope: ['telegram'] });
    const decision = await policy.evaluate({
      definition: activeDef,
      grant,
      trigger,
      simulation: validSimulation({ proposedActions: [{ actionType: 'notify', capability: 'sms:send_message', effect: 'send' }] }),
      context: baseContext({ channel: 'sms' }),
    });
    expect(decision.decision).toBe('deny');
  });
});
