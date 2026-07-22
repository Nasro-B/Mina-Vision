import { describe, expect, it } from 'vitest';
import {
  floatToPcm16, sliceStyleVector, splitSentences, styleVectorOffset,
} from '../src/voice/local-voice-synthesis.mjs';

describe('splitSentences — streaming par phrase pour la voix locale', () => {
  it('découpe aux fins de phrases françaises et garde la ponctuation', () => {
    expect(splitSentences('Bonjour mon créateur. Je vous écoute ! Ça va ?')).toEqual([
      'Bonjour mon créateur.', 'Je vous écoute !', 'Ça va ?',
    ]);
  });

  it('renvoie vide pour un texte vide et une seule entrée sans ponctuation', () => {
    expect(splitSentences('   ')).toEqual([]);
    expect(splitSentences('juste un fragment')).toEqual(['juste un fragment']);
  });

  it('recoupe une tirade sans ponctuation pour préserver la lecture continue', () => {
    const tirade = `${'mot '.repeat(120)}fin`.trim(); // ≈ 480 caractères d'un seul tenant
    const parts = splitSentences(tirade);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(220);
    expect(parts.join(' ')).toBe(tirade);
  });

  it('préfère couper à une virgule quand elle existe', () => {
    const phrase = `${'a'.repeat(150)}, ${'b'.repeat(150)}.`;
    const parts = splitSentences(phrase);
    expect(parts[0]).toBe(`${'a'.repeat(150)},`);
  });
});

describe('floatToPcm16 — même format que le flux Gemini (PCM16)', () => {
  it('convertit et borne les échantillons hors plage', () => {
    const pcm = floatToPcm16(new Float32Array([0, 0.5, 1, -1, 2, -2]));
    expect(pcm[0]).toBe(0);
    expect(pcm[1]).toBe(16384);
    expect(pcm[2]).toBe(32767);
    expect(pcm[3]).toBe(-32767);
    expect(pcm[4]).toBe(32767); // clippé, jamais de débordement
    expect(pcm[5]).toBe(-32767);
  });
});

describe('style vector — sélection par longueur, contrat kokoro exact', () => {
  it('réplique le slicing 256 × min(max(tokens-2, 0), 509)', () => {
    expect(styleVectorOffset(2)).toBe(0);
    expect(styleVectorOffset(1)).toBe(0);
    expect(styleVectorOffset(12)).toBe(2560);
    expect(styleVectorOffset(10_000)).toBe(256 * 509);
  });

  it('découpe le bon vecteur et refuse un débordement', () => {
    const style = new Float32Array(510 * 256).map((_, index) => index % 7);
    const vector = sliceStyleVector(style, 12);
    expect(vector).toHaveLength(256);
    expect(vector[0]).toBe(style[2560]);
    expect(() => sliceStyleVector(new Float32Array(300), 12)).toThrow('local_voice_style_out_of_range');
    expect(() => sliceStyleVector([1, 2, 3], 2)).toThrow('local_voice_style_invalid');
  });
});
