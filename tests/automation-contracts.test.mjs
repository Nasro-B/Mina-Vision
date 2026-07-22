import { describe, expect, it } from 'vitest';
import { AUTOMATION_STATUSES, NEXT, canTransition, validateAutomationDefinition } from '../src/automation/automation-contracts.mjs';

describe('AUTOMATION_STATUSES: exact six-state vocabulary', () => {
  it('lists exactly the six statuses required by the plan', () => {
    expect([...AUTOMATION_STATUSES]).toEqual(['draft', 'shadow', 'supervised', 'active', 'suspended', 'revoked']);
  });

  it('is frozen so callers cannot mutate the shared vocabulary', () => {
    expect(Object.isFrozen(AUTOMATION_STATUSES)).toBe(true);
  });
});

describe('NEXT: immutable status-transition table', () => {
  it('matches the exact transition table from the plan', () => {
    expect(NEXT.draft).toEqual(new Set(['shadow', 'revoked']));
    expect(NEXT.shadow).toEqual(new Set(['supervised', 'suspended', 'revoked']));
    expect(NEXT.supervised).toEqual(new Set(['active', 'suspended', 'revoked']));
    expect(NEXT.active).toEqual(new Set(['suspended', 'revoked']));
    expect(NEXT.suspended).toEqual(new Set(['shadow', 'revoked']));
    expect(NEXT.revoked).toEqual(new Set());
  });

  it('is frozen at the top level', () => {
    expect(Object.isFrozen(NEXT)).toBe(true);
  });
});

describe('canTransition: transition-table lookup helper', () => {
  it('allows a listed transition', () => {
    expect(canTransition('draft', 'shadow')).toBe(true);
  });

  it('rejects activation directly from draft, skipping shadow and supervision', () => {
    expect(canTransition('draft', 'active')).toBe(false);
  });

  it('rejects any transition out of revoked, the terminal state', () => {
    expect(canTransition('revoked', 'draft')).toBe(false);
  });

  it('rejects an unknown source status instead of throwing', () => {
    expect(canTransition('not_a_status', 'draft')).toBe(false);
  });
});

describe('validateAutomationDefinition: strict creation-input contract', () => {
  const valid = { name: 'Rappel arrosage', description: 'Rappelle d\'arroser les plantes le lundi', status: 'draft' };

  it('accepts a well-formed definition input, defaults allowedActions to empty, and freezes the result', () => {
    const parsed = validateAutomationDefinition(valid);
    expect(parsed).toEqual({ ...valid, allowedActions: [] });
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it('accepts an explicit allowedActions allowlist', () => {
    const withActions = { ...valid, allowedActions: [{ actionType: 'notify', capability: 'telegram:send_message' }] };
    const parsed = validateAutomationDefinition(withActions);
    expect(parsed.allowedActions).toEqual(withActions.allowedActions);
  });

  it('rejects an allowedActions entry missing capability', () => {
    expect(() => validateAutomationDefinition({ ...valid, allowedActions: [{ actionType: 'notify' }] })).toThrow();
  });

  it('rejects a missing name', () => {
    const { name, ...rest } = valid;
    expect(() => validateAutomationDefinition(rest)).toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => validateAutomationDefinition({ ...valid, name: '' })).toThrow();
  });

  it('rejects a status outside the six-state vocabulary', () => {
    expect(() => validateAutomationDefinition({ ...valid, status: 'active_forever' })).toThrow();
  });

  it('rejects unknown extra fields (strict object)', () => {
    expect(() => validateAutomationDefinition({ ...valid, automationId: 'should-not-be-here' })).toThrow();
  });
});
