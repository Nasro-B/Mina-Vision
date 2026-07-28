import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Mina Vision voice presence UI contract', () => {
  it('ships an accessible live canvas and wires microphone, thinking and playback events', () => {
    const html = readFileSync(new URL('../src/ui/index.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
    const renderer = readFileSync(new URL('../src/ui/renderer.js', import.meta.url), 'utf8');

    expect(html).toContain('id="voice-presence-canvas"');
    expect(html).toContain('id="voice-animation-select"');
    expect(html).toContain('<option value="cloudzir">CloudZIR Spectral</option>');
    expect(html).toContain('class="cloudzir-nebula"');
    expect((html.match(/class="cloudzir-nebula-bar"/gu) ?? [])).toHaveLength(7);
    expect(html).toContain('id="voice-presence-label"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('class="voice-presence-status"');
    expect(html).not.toContain('class="voice-presence-kicker"');
    expect(html).not.toContain('>Dites « Salut Mina »<');
    expect(html).not.toContain('>Mina Vision est prête<');
    expect(css).toContain('.voice-presence');
    expect(css).toContain('.voice-presence-status');
    expect(css).toContain('@keyframes cloudzir-neural-pulse');
    expect(css).toContain('filter: blur(120px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(renderer).toContain("from './voice-presence.mjs'");
    expect(renderer).toContain('voiceAnimationPreference.load()');
    expect(renderer).toContain("voicePresence.setAnimation(elements.voiceAnimation.value)");
    expect(renderer).toContain("type: 'capture_started'");
    expect(renderer).toContain("type: 'transcript_final'");
    expect(renderer).toContain("type: 'audio_chunk'");
    expect(renderer).toContain("type: 'playback_finished'");
  });

  it('CloudZIR keeps its exact original SHAPE — palettes may only change the gradient', () => {
    const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');

    // The shape is defined by these transforms and the bar geometry. If a colour feature ever
    // rewrites them, this test fails — Nasro asked explicitly to never change the form.
    expect(css).toContain('transform: scaleY(0.8) scaleX(0.9) translateY(0)');
    expect(css).toContain('transform: scaleY(2.5) scaleX(1.2) translateY(-30px)');
    expect(css).toContain('transform: scaleY(1.2) scaleX(1.1) translateY(10px)');
    expect(css).toMatch(/\.cloudzir-nebula-bar\s*\{[^}]*width:\s*96px/u);
    expect(css).toMatch(/\.cloudzir-nebula-bar\s*\{[^}]*height:\s*192px/u);
    expect(css).toMatch(/\.cloudzir-nebula-bar\s*\{[^}]*border-radius:\s*100%/u);

    // Colour is variable-driven, with the original green as the built-in fallback.
    expect(css).toMatch(/background:\s*linear-gradient\(to top,\s*var\(--cloudzir-from,\s*#10b981\),\s*var\(--cloudzir-to,\s*#059669\)\)/u);
  });

  it('re-sends a readback killed by the echo of the owner question instead of continuing over silence', () => {
    const renderer = readFileSync(new URL('../src/ui/renderer.js', import.meta.url), 'utf8');

    // An interruption inside the grace window kills the audio SERVER-side: ignoring it client-side
    // plays nothing (« liste tes outils » → silence → « et voilà »). The only recovery is re-sending
    // the same line, exactly once.
    expect(renderer).toContain('readbackRetryUsed');
    expect(renderer).toContain('lastReadbackText = text');
    expect(renderer).toMatch(/readbackRetryUsed = true;[\s\S]{0,400}api\.sayVoice\(lastReadbackText\)/u);
    // The retry must not loop: the flag is armed before the re-send and only say() re-opens it.
    expect(renderer).toMatch(/const say = async \(text\) => \{[\s\S]{0,200}readbackRetryUsed = false/u);
  });

  it('exposes a fullscreen control for the voice animation and cycles CloudZIR colour on click', () => {
    const html = readFileSync(new URL('../src/ui/index.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
    const renderer = readFileSync(new URL('../src/ui/renderer.js', import.meta.url), 'utf8');

    expect(html).toContain('id="voice-fullscreen-button"');
    expect(css).toContain('.voice-presence:fullscreen');
    expect(renderer).toContain('requestFullscreen()');
    expect(renderer).toContain('nextCloudzirPalette');
    expect(renderer).toContain("setProperty('--cloudzir-from'");
  });

  it('shields the mic feed during deterministic readbacks while keeping REAL barge-in local', () => {
    const renderer = readFileSync(new URL('../src/ui/renderer.js', import.meta.url), 'utf8');

    // say() arms the shield sized to the text AND stamps the arming instant, so the pump can tell
    // "audio of THIS turn hasn't started yet" from "the turn is really over".
    expect(renderer).toMatch(/readbackArmedAt = Date\.now\(\)/u);
    expect(renderer).toMatch(/readbackShieldUntil = readbackArmedAt \+ readbackShieldDuration\(text\)/u);
    // The mic pump holds on the REAL voice flow (armedAt + queued sources + last chunk), not on the
    // estimated deadline alone — so a mid-brief queue underrun no longer reopens the mic.
    expect(renderer).toMatch(/isReadbackShieldHolding\(\{[\s\S]{0,240}armedAt: readbackArmedAt[\s\S]{0,120}queuedSources: scheduledVoiceSources\.size[\s\S]{0,120}lastAudioAt: lastVoiceAudioAt/u);
    // Real sustained speech pierces the shield, stops playback, and the SAME chunk is forwarded.
    expect(renderer).toMatch(/bargeInDetector\.push\(normalizeVoiceLevel\(samples\)\)/u);
    // The BUG this fixed must not creep back: a transient queue drain must NEVER lower the shield —
    // that reopened the mic mid-brief, the echo killed generation, and the model said « et voilà ».
    expect(renderer).not.toMatch(/readbackShieldUntil = Math\.min/u);
    // Any real cut still clears the shield outright.
    expect(renderer).toMatch(/const stopVoicePlayback = \(\) => \{[\s\S]{0,200}readbackShieldUntil = 0/u);
  });
});
