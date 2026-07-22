import { describe, expect, it } from 'vitest';
import { detectStopPhrase, detectWakePhrase } from '../src/voice/wake-phrases.mjs';

describe('Mina wake phrases', () => {
  it.each([
    ['Salut Mina, ouvre Chrome', 'ouvre Chrome'],
    ['Bonjour Mina', ''],
    ['Mina comment ça va ?', ''],
    ['MINA, COMMENT ÇA VA : lance le tri', 'lance le tri'],
    ['Mina, active la caméra', 'active la caméra'],
    ['Mina mets de la musique', 'mets de la musique'],
    ['Hey Mina, version nuit', 'version nuit'],
  ])('activates on %s', (input, remainder) => {
    expect(detectWakePhrase(input)).toMatchObject({ activated: true, remainder });
  });

  it.each(['minable', 'salut Nina', 'bonjour à tous', 'Mina'])('rejects false positive %s', (input) => {
    expect(detectWakePhrase(input).activated).toBe(false);
  });

  it('detects the explicit stop command', () => {
    expect(detectStopPhrase('Mina, arrête !')).toBe(true);
    expect(detectStopPhrase('arrête')).toBe(false);
  });
});
