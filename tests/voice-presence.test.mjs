import { describe, expect, it, vi } from 'vitest';
import {
  createVoiceAnimationPreference, createVoicePresence, normalizeVoiceAnimation,
  normalizeVoiceLevel, reduceVoicePresence,
} from '../src/ui/voice-presence.mjs';

describe('Mina Vision voice presence', () => {
  it('maps the real voice lifecycle to visible states', () => {
    let state = reduceVoicePresence(undefined, { type: 'capture_started' });
    expect(state).toMatchObject({ mode: 'listening', label: 'Je vous écoute' });
    state = reduceVoicePresence(state, { type: 'transcript_final' });
    expect(state).toMatchObject({ mode: 'thinking', label: 'Je réfléchis' });
    state = reduceVoicePresence(state, { type: 'audio_chunk' });
    expect(state).toMatchObject({ mode: 'speaking', label: 'Mina répond' });
    state = reduceVoicePresence(state, { type: 'playback_finished' });
    expect(state).toMatchObject({ mode: 'listening', label: 'Je vous écoute' });
    state = reduceVoicePresence(state, { type: 'capture_stopped' });
    expect(state).toMatchObject({ mode: 'idle', label: 'Dites « Salut Mina »' });
  });

  it('normalizes microphone RMS without allowing invalid levels', () => {
    expect(normalizeVoiceLevel(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5, 5);
    expect(normalizeVoiceLevel(4)).toBe(1);
    expect(normalizeVoiceLevel(Number.NaN)).toBe(0);
  });

  it('persists only supported Mina and CloudZIR animation themes', () => {
    const values = new Map([['mina.voice.animation', 'cloudzir']]);
    const storage = {
      getItem: vi.fn((key) => values.get(key) ?? null),
      setItem: vi.fn((key, value) => values.set(key, value)),
    };
    const preference = createVoiceAnimationPreference({ storage });

    expect(normalizeVoiceAnimation('cloudzir')).toBe('cloudzir');
    expect(normalizeVoiceAnimation('unknown')).toBe('mina');
    expect(preference.load()).toBe('cloudzir');
    expect(preference.save('mina')).toBe('mina');
    expect(storage.setItem).toHaveBeenCalledWith('mina.voice.animation', 'mina');
  });

  it('updates accessible labels and renders the canvas without innerHTML', () => {
    const context = {
      clearRect: vi.fn(), setTransform: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), stroke: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), fill: vi.fn(), save: vi.fn(), restore: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    };
    const canvas = {
      width: 0, height: 0, clientWidth: 320, clientHeight: 220, dataset: {},
      getContext: vi.fn(() => context),
    };
    const label = { textContent: '' };
    const detail = { textContent: '' };
    const container = { dataset: {} };
    const presence = createVoicePresence({
      canvas, container, label, detail, devicePixelRatio: 1,
      requestFrame: vi.fn(() => 1), cancelFrame: vi.fn(), reducedMotion: true,
    });

    presence.setAnimation('cloudzir');
    presence.dispatch({ type: 'capture_started' });
    presence.setLevel(0.7);
    presence.render(100);

    expect(canvas.dataset.voiceState).toBe('listening');
    expect(container.dataset.animation).toBe('cloudzir');
    expect(container.dataset.audioActivity).toBe('active');
    expect(label.textContent).toBe('Je vous écoute');
    expect(detail.textContent).toContain('Microphone actif');
    expect(context.arc).toHaveBeenCalled();
    presence.destroy();
  });
});

describe('CloudZIR colour palettes (colour only — the shape is never touched)', () => {
  it('exposes several distinct palettes, each with a from/to gradient pair', async () => {
    const { CLOUDZIR_PALETTES } = await import('../src/ui/voice-presence.mjs');
    expect(CLOUDZIR_PALETTES.length).toBeGreaterThanOrEqual(4);
    for (const palette of CLOUDZIR_PALETTES) {
      expect(palette.id).toMatch(/^[a-z-]+$/u);
      expect(palette.from).toMatch(/^#[0-9a-f]{6}$/iu);
      expect(palette.to).toMatch(/^#[0-9a-f]{6}$/iu);
    }
    const ids = CLOUDZIR_PALETTES.map((palette) => palette.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the original green as the first palette so the current look is unchanged by default', async () => {
    const { CLOUDZIR_PALETTES } = await import('../src/ui/voice-presence.mjs');
    expect(CLOUDZIR_PALETTES[0]).toMatchObject({ from: '#10b981', to: '#059669' });
  });

  it('nextCloudzirPalette cycles forward and wraps around', async () => {
    const { CLOUDZIR_PALETTES, nextCloudzirPalette } = await import('../src/ui/voice-presence.mjs');
    const first = CLOUDZIR_PALETTES[0].id;
    const second = CLOUDZIR_PALETTES[1].id;
    expect(nextCloudzirPalette(first)).toBe(second);
    expect(nextCloudzirPalette(CLOUDZIR_PALETTES.at(-1).id)).toBe(first);
  });

  it('normalizeCloudzirPalette falls back to the first palette for anything unknown', async () => {
    const { CLOUDZIR_PALETTES, normalizeCloudzirPalette, nextCloudzirPalette } = await import('../src/ui/voice-presence.mjs');
    expect(normalizeCloudzirPalette('nope')).toBe(CLOUDZIR_PALETTES[0].id);
    expect(normalizeCloudzirPalette(null)).toBe(CLOUDZIR_PALETTES[0].id);
    expect(nextCloudzirPalette('nope')).toBe(CLOUDZIR_PALETTES[1].id);
  });

  it('cloudzirPaletteColors returns the gradient pair for an id, falling back safely', async () => {
    const { CLOUDZIR_PALETTES, cloudzirPaletteColors } = await import('../src/ui/voice-presence.mjs');
    expect(cloudzirPaletteColors(CLOUDZIR_PALETTES[1].id)).toEqual({ from: CLOUDZIR_PALETTES[1].from, to: CLOUDZIR_PALETTES[1].to });
    expect(cloudzirPaletteColors('unknown')).toEqual({ from: CLOUDZIR_PALETTES[0].from, to: CLOUDZIR_PALETTES[0].to });
  });

  it('persists the chosen palette like the animation preference does', async () => {
    const { createCloudzirPalettePreference, CLOUDZIR_PALETTES } = await import('../src/ui/voice-presence.mjs');
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    const preference = createCloudzirPalettePreference({ storage });

    expect(preference.load()).toBe(CLOUDZIR_PALETTES[0].id);
    expect(preference.save(CLOUDZIR_PALETTES[2].id)).toBe(CLOUDZIR_PALETTES[2].id);
    expect(preference.load()).toBe(CLOUDZIR_PALETTES[2].id);
    expect(preference.save('bogus')).toBe(CLOUDZIR_PALETTES[0].id);
  });

  it('survives a storage that throws (private mode) without losing the session choice', async () => {
    const { createCloudzirPalettePreference, CLOUDZIR_PALETTES } = await import('../src/ui/voice-presence.mjs');
    const storage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const preference = createCloudzirPalettePreference({ storage });
    expect(preference.load()).toBe(CLOUDZIR_PALETTES[0].id);
    expect(preference.save(CLOUDZIR_PALETTES[1].id)).toBe(CLOUDZIR_PALETTES[1].id);
  });
});

describe('playback suppression window (after a barge-in)', () => {
  it('suppresses residual chunks of the killed turn right after the cut', async () => {
    const { isPlaybackSuppressed } = await import('../src/ui/voice-presence.mjs');
    expect(isPlaybackSuppressed({ suppressedAt: 1_000, now: 1_100 })).toBe(true);
  });

  it('AUTO-EXPIRES so a later, unrelated reply is never silently swallowed forever', async () => {
    const { isPlaybackSuppressed } = await import('../src/ui/voice-presence.mjs');
    // The bug this guards: the flag used to be cleared only when Mina spoke a deterministic line,
    // so a plain conversational reply after any interruption stayed mute permanently.
    expect(isPlaybackSuppressed({ suppressedAt: 1_000, now: 1_000 + 5_000 })).toBe(false);
  });

  it('never suppresses when nothing was ever cut', async () => {
    const { isPlaybackSuppressed } = await import('../src/ui/voice-presence.mjs');
    expect(isPlaybackSuppressed({ suppressedAt: 0, now: 999_999 })).toBe(false);
    expect(isPlaybackSuppressed({ suppressedAt: null, now: 10 })).toBe(false);
  });

  it('honours the exact boundary of the configured window', async () => {
    const { isPlaybackSuppressed, PLAYBACK_SUPPRESSION_MS } = await import('../src/ui/voice-presence.mjs');
    expect(PLAYBACK_SUPPRESSION_MS).toBeGreaterThan(0);
    expect(PLAYBACK_SUPPRESSION_MS).toBeLessThanOrEqual(3_000);
    const at = 5_000;
    expect(isPlaybackSuppressed({ suppressedAt: at, now: at + PLAYBACK_SUPPRESSION_MS - 1 })).toBe(true);
    expect(isPlaybackSuppressed({ suppressedAt: at, now: at + PLAYBACK_SUPPRESSION_MS })).toBe(false);
  });
});

describe('readback shield — la lecture longue ne peut plus être tuée par son propre écho', () => {
  it('scales the shield with text length, capped, and zero for empty text', async () => {
    const { readbackShieldDuration } = await import('../src/ui/voice-presence.mjs');
    expect(readbackShieldDuration('')).toBe(0);
    expect(readbackShieldDuration('a'.repeat(100))).toBe(1_500 + 7_000);
    expect(readbackShieldDuration('a'.repeat(10_000))).toBe(45_000); // borne dure
  });

  it('is active strictly before the deadline', async () => {
    const { isShieldActive } = await import('../src/ui/voice-presence.mjs');
    expect(isShieldActive({ shieldUntil: 1_000, now: 999 })).toBe(true);
    expect(isShieldActive({ shieldUntil: 1_000, now: 1_000 })).toBe(false);
    expect(isShieldActive({ shieldUntil: 0, now: 1 })).toBe(false);
    expect(isShieldActive({})).toBe(false);
  });

  it('fires ONLY on sustained loud speech — residual echo blips never interrupt', async () => {
    const { createBargeInDetector } = await import('../src/ui/voice-presence.mjs');
    const detector = createBargeInDetector({ threshold: 0.09, sustainMs: 350, frameMs: 85 });

    // écho résiduel : pics brefs entrecoupés de retombées
    expect(detector.push(0.12)).toBe(false);
    expect(detector.push(0.03)).toBe(false);
    expect(detector.push(0.15)).toBe(false);
    expect(detector.push(0.02)).toBe(false);

    // vraie voix : niveau tenu → interruption au 5e frame (425 ms ≥ 350 ms garantis)
    expect(detector.push(0.2)).toBe(false); // 85
    expect(detector.push(0.2)).toBe(false); // 170
    expect(detector.push(0.2)).toBe(false); // 255
    expect(detector.push(0.2)).toBe(false); // 340 — toujours sous les 350 ms
    expect(detector.push(0.2)).toBe(true); // 425 — vraie interruption

    detector.reset();
    expect(detector.push(0.2)).toBe(false); // le reset repart de zéro
  });
});
