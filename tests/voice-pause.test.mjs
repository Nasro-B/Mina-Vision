import { describe, expect, it } from 'vitest';
import { createPauseGate, detectPauseCommand, detectResumeCommand } from '../src/voice/speech-stop.mjs';

describe('detectPauseCommand — entrée en pause', () => {
  it.each([
    'pause',
    'Pause.',
    'mets-toi en pause',
    'mets toi en pause',
    'en pause',
    'fais une pause',
    'mina en pause',
  ])('active sur « %s »', (fragment) => {
    expect(detectPauseCommand(fragment)).toBe(true);
  });

  it.each([
    'on fera une pause déjeuner vers midi avec toute la famille',
    'lance la mission',
    'pausera',
    '',
  ])('n\'active PAS sur « %s »', (fragment) => {
    expect(detectPauseCommand(fragment)).toBe(false);
  });
});

describe('detectResumeCommand — le NOM réveille', () => {
  it.each([
    'mina',
    'Mina.',
    'reprends mina',
    'mina reprends',
    'mina reviens',
    'salut mina',
    'reprend mina',
  ])('réveille sur « %s »', (fragment) => {
    expect(detectResumeCommand(fragment)).toBe(true);
  });

  it.each([
    'il faudrait demander à mina de faire les courses demain matin très tôt',
    'continue',
    'reprends',
    'illumina',
    '',
  ])('ne réveille PAS sur « %s »', (fragment) => {
    expect(detectResumeCommand(fragment)).toBe(false);
  });
});

describe('createPauseGate', () => {
  it('inactif par défaut, pause/resume idempotents', () => {
    const gate = createPauseGate();
    expect(gate.isPaused()).toBe(false);
    gate.pause();
    gate.pause();
    expect(gate.isPaused()).toBe(true);
    gate.resume();
    expect(gate.isPaused()).toBe(false);
    gate.resume();
    expect(gate.isPaused()).toBe(false);
  });
});
