import { describe, expect, it } from 'vitest';
import { classifyAction, classifyCapabilityBase } from '../src/safety/policy.mjs';

describe('classifyAction', () => {
  it.each([
    'delete',
    'upload',
    'download',
    'print',
    'send_message',
    'purchase',
    'authenticate',
    'change_system',
  ])('%s requires confirmation', (name) => {
    expect(classifyAction({ name, arguments: {} }, { app: 'Chrome' }).decision).toBe('confirm');
  });

  it.each(['1Password', 'Sécurité Windows', 'Windows Terminal'])('blocks %s', (app) => {
    expect(classifyAction({ name: 'click', arguments: {} }, { app }).decision).toBe('block');
  });

  it('honors a Gemini block before local allow rules', () => {
    expect(classifyAction({ name: 'click', safetyDecision: 'blocked' }, { app: 'Chrome' }).decision).toBe('block');
  });

  it('allows a normal click in an allowed application', () => {
    expect(classifyAction({ name: 'click', intent: 'Focus search' }, { app: 'Chrome' })).toEqual({
      decision: 'allow',
      reason: 'Action locale non sensible.',
    });
  });

  it.each([
    { name: 'key', keys: ['CTRL', 'P'], intent: 'Ouvrir l’impression' },
    { name: 'click', intent: 'Télécharger le document PDF' },
    { name: 'click', intent: 'Cliquer sur Imprimer' },
  ])('requires confirmation for semantic print/download actions', (action) => {
    expect(classifyAction(action, { app: 'Chrome' }).decision).toBe('confirm');
  });

  it('does not confuse a normal recipe search with a sensitive action', () => {
    expect(classifyAction({ name: 'type', text: 'recette de gâteau', intent: 'Chercher une recette' }, { app: 'Chrome' }).decision).toBe('allow');
  });
});

describe('classifyCapabilityBase', () => {
  it.each([
    'system.terminal.execute',
    'credentials.password_manager.read',
    'security.windows.change',
  ])('blocks %s before channel or session grants', (capability) => {
    expect(classifyCapabilityBase({ capability, effect: 'execute' })).toMatchObject({
      decision: 'deny',
      reason: 'base_policy',
    });
  });

  it('requires confirmation for local filesystem writes', () => {
    expect(classifyCapabilityBase({ capability: 'filesystem.write', effect: 'write' }))
      .toMatchObject({ decision: 'confirm' });
  });
});
