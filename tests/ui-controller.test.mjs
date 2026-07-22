import { describe, expect, it, vi } from 'vitest';
import { createVoiceCommandRouter, formatGroundingLabel, validateMissionRequest } from '../src/ui/controller.mjs';

describe('validateMissionRequest', () => {
  it('accepts only supported environments and bounded goals', () => {
    expect(validateMissionRequest({ goal: 'Ouvre Google', environment: 'browser' }))
      .toEqual({ goal: 'Ouvre Google', environment: 'browser' });
    expect(validateMissionRequest({ goal: 'Rappelle mon rendez-vous', environment: 'browser', memoryRequired: true }))
      .toEqual({ goal: 'Rappelle mon rendez-vous', environment: 'browser', memoryRequired: true });
    expect(() => validateMissionRequest({ goal: '', environment: 'browser' })).toThrow('instruction');
    expect(() => validateMissionRequest({ goal: 'test', environment: 'shell' })).toThrow(/environnement/i);
  });
});

describe('createVoiceCommandRouter', () => {
  it('activates Mina, forwards the command, and handles emergency stop', () => {
    const onWake = vi.fn();
    const onCommand = vi.fn();
    const onStop = vi.fn();
    const router = createVoiceCommandRouter({ onWake, onCommand, onStop });

    router.push('Salut Mina');
    router.push('ouvre Google Photos');
    router.push('Mina, arrête');

    expect(onWake).toHaveBeenCalledOnce();
    expect(onCommand).toHaveBeenCalledWith('ouvre Google Photos');
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('uses a command appended to a wake phrase immediately', () => {
    const onCommand = vi.fn();
    const router = createVoiceCommandRouter({ onCommand });

    router.push('Bonjour Mina, ouvre la caméra');

    expect(onCommand).toHaveBeenCalledWith('ouvre la caméra');
  });
});

describe('formatGroundingLabel', () => {
  it.each([
    ['verified', 'Vérifié'],
    ['inference', 'Inférence'],
    ['uncertain', 'Incertain'],
    ['unsupported', 'Action non vérifiée'],
  ])('maps %s to %s', (status, label) => {
    expect(formatGroundingLabel(status)).toBe(label);
  });
});
