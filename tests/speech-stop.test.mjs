import { describe, expect, it } from 'vitest';
import { createSpeechGate, detectStopCommand } from '../src/voice/speech-stop.mjs';

describe('detectStopCommand — mot d\'arrêt de parole', () => {
  it.each([
    'stop',
    'Stop.',
    'STOP !',
    'chut',
    'silence',
    'tais-toi',
    'tais toi',
    'arrête',
    'arrete',
    'arrête-toi',
    'stop stop',
    'mina stop',
    'ok stop merci',
  ])('coupe sur « %s »', (fragment) => {
    expect(detectStopCommand(fragment)).toBe(true);
  });

  it.each([
    'nonstop',
    'le bus stoppa net',
    'arrête la musique quand la chanson se termine tranquillement',
    'peux-tu chercher un tutoriel sans t\'arrêter sur les publicités du site',
    '',
    '   ',
    'lance la mission',
  ])('ne coupe PAS sur « %s »', (fragment) => {
    expect(detectStopCommand(fragment)).toBe(false);
  });

  it('énoncé court avec le mot = coupe (« arrête la musique » coupe la parole, l\'intent suit)', () => {
    expect(detectStopCommand('arrête la musique')).toBe(true);
  });
});

describe('createSpeechGate — suppression des chunks du tour interrompu', () => {
  it('inactif par défaut, actif après stop, relâché en fin de tour', () => {
    const gate = createSpeechGate();
    expect(gate.shouldSuppress()).toBe(false);
    gate.noteStop();
    expect(gate.shouldSuppress()).toBe(true);
    gate.noteTurnComplete();
    expect(gate.shouldSuppress()).toBe(false);
  });

  it('un stop pendant la suppression reste supprimé jusqu\'à la fin de tour suivante', () => {
    const gate = createSpeechGate();
    gate.noteStop();
    gate.noteStop();
    expect(gate.shouldSuppress()).toBe(true);
    gate.noteTurnComplete();
    expect(gate.shouldSuppress()).toBe(false);
  });
});
