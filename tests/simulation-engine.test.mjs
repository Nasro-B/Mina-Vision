import { describe, expect, it, vi } from 'vitest';
import { createSimulationEngine } from '../src/automation/simulation-engine.mjs';
import { normalizeTrigger } from '../src/automation/trigger-normalizer.mjs';

const definition = Object.freeze({
  automationId: 'def-1',
  name: 'Rappel arrosage',
  status: 'shadow',
  version: 3,
  allowedActions: [{ actionType: 'notify', capability: 'telegram:send_message' }],
});

const trigger = normalizeTrigger({
  triggerId: 't-1',
  type: 'schedule',
  occurredAt: '2026-07-16T08:00:00.000Z',
  payload: { actions: [{ actionType: 'notify', capability: 'telegram:send_message', text: 'Arrose les plantes' }] },
});

function fakeDomains({ execute = vi.fn(), uncertainty = null } = {}) {
  return {
    simulate: vi.fn(async (action) => ({ preview: `would ${action.actionType} via ${action.capability}`, uncertainty })),
    execute,
  };
}

const budgetEstimator = vi.fn(() => ({ estimatedTokens: 120, estimatedCostCents: 0 }));
const disclosureClassifier = vi.fn(() => ['Enverra un message Telegram à Nasro']);
const clock = () => 1_700_000_000_000;

describe('createSimulationEngine: constructor guards', () => {
  it('requires a domainRegistry', () => {
    expect(() => createSimulationEngine({ budgetEstimator, disclosureClassifier, clock })).toThrow('simulation_engine_domain_registry_required');
  });
});

describe('createSimulationEngine.simulate: effect-free shadow simulation', () => {
  it('never calls execute during shadow simulation', async () => {
    const execute = vi.fn();
    const engine = createSimulationEngine({ domainRegistry: fakeDomains({ execute }), budgetEstimator, disclosureClassifier, clock });
    const result = await engine.simulate({ definition, trigger, context: { mode: 'shadow' } });
    expect(execute).not.toHaveBeenCalled();
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('only ever calls domainRegistry.simulate, never any other method', async () => {
    const domainRegistry = fakeDomains();
    const engine = createSimulationEngine({ domainRegistry, budgetEstimator, disclosureClassifier, clock });
    await engine.simulate({ definition, trigger, context: { mode: 'shadow' } });
    expect(domainRegistry.simulate).toHaveBeenCalledTimes(1);
    expect(domainRegistry.simulate).toHaveBeenCalledWith(
      { actionType: 'notify', capability: 'telegram:send_message', text: 'Arrose les plantes' },
      { mode: 'shadow' },
    );
  });

  it('produces a stable simulationId, frozen proposedActions/disclosures/uncertainties, and the estimator/classifier outputs', async () => {
    const engine = createSimulationEngine({ domainRegistry: fakeDomains(), budgetEstimator, disclosureClassifier, clock });
    const result = await engine.simulate({ definition, trigger, context: { mode: 'shadow' } });
    expect(typeof result.simulationId).toBe('string');
    expect(result.simulationId.length).toBeGreaterThan(0);
    expect(Object.isFrozen(result.proposedActions)).toBe(true);
    expect(Object.isFrozen(result.disclosures)).toBe(true);
    expect(Object.isFrozen(result.uncertainties)).toBe(true);
    expect(result.proposedActions).toEqual(trigger.payload.actions);
    expect(result.disclosures).toEqual(['Enverra un message Telegram à Nasro']);
    expect(result.estimatedUsage).toEqual({ estimatedTokens: 120, estimatedCostCents: 0 });
  });

  it('collects a non-null uncertainty returned by a domain simulate call', async () => {
    const engine = createSimulationEngine({
      domainRegistry: fakeDomains({ uncertainty: 'device_state_unknown' }),
      budgetEstimator,
      disclosureClassifier,
      clock,
    });
    const result = await engine.simulate({ definition, trigger, context: { mode: 'shadow' } });
    expect(result.uncertainties).toEqual(['device_state_unknown']);
  });

  it('produces the same digest for the same definition version, trigger and proposed actions', async () => {
    const engine = createSimulationEngine({ domainRegistry: fakeDomains(), budgetEstimator, disclosureClassifier, clock });
    const first = await engine.simulate({ definition, trigger, context: { mode: 'shadow' } });
    const second = await engine.simulate({ definition, trigger, context: { mode: 'shadow' } });
    expect(first.digest).toBe(second.digest);
  });

  it('produces a different digest when the definition version changes', async () => {
    const engine = createSimulationEngine({ domainRegistry: fakeDomains(), budgetEstimator, disclosureClassifier, clock });
    const first = await engine.simulate({ definition, trigger, context: { mode: 'shadow' } });
    const bumped = await engine.simulate({ definition: { ...definition, version: 4 }, trigger, context: { mode: 'shadow' } });
    expect(first.digest).not.toBe(bumped.digest);
  });

  it('rejects a trigger-proposed action whose (actionType, capability) is not in the definition allowlist, and never reaches the domain registry for it', async () => {
    const domainRegistry = fakeDomains();
    const engine = createSimulationEngine({ domainRegistry, budgetEstimator, disclosureClassifier, clock });
    const badTrigger = normalizeTrigger({
      triggerId: 't-2',
      type: 'schedule',
      occurredAt: '2026-07-16T08:00:00.000Z',
      payload: { actions: [{ actionType: 'execute_script', capability: 'shell:rm-rf', script: 'evil.sh' }] },
    });
    await expect(engine.simulate({ definition, trigger: badTrigger, context: { mode: 'shadow' } }))
      .rejects.toThrow('automation_action_not_allowed');
    expect(domainRegistry.simulate).not.toHaveBeenCalled();
  });

  it('treats a trigger with no proposed actions as a valid empty-effect simulation', async () => {
    const emptyTrigger = normalizeTrigger({ triggerId: 't-3', type: 'manual', occurredAt: '2026-07-16T08:00:00.000Z', payload: {} });
    const domainRegistry = fakeDomains();
    const engine = createSimulationEngine({ domainRegistry, budgetEstimator, disclosureClassifier, clock });
    const result = await engine.simulate({ definition, trigger: emptyTrigger, context: { mode: 'shadow' } });
    expect(result.proposedActions).toEqual([]);
    expect(domainRegistry.simulate).not.toHaveBeenCalled();
  });
});
