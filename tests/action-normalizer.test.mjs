import { describe, expect, it } from 'vitest';
import { normalizeAction } from '../src/executors/action-normalizer.mjs';

const viewport = { width: 1_920, height: 1_080 };

describe('normalizeAction', () => {
  it('denormalizes Gemini coordinates', () => {
    const action = normalizeAction({
      name: 'click',
      arguments: { x: 500, y: 250, intent: 'Focus search' },
    }, viewport);

    expect(action).toMatchObject({
      name: 'click',
      x: 960,
      y: 270,
      intent: 'Focus search',
    });
  });

  it('normalizes scroll and safety metadata', () => {
    const action = normalizeAction({
      name: 'scroll',
      arguments: {
        x: 500,
        y: 500,
        scroll_x: 0,
        scroll_y: 600,
        safety_decision: { decision: 'require_confirmation' },
      },
    }, viewport);

    expect(action).toMatchObject({
      name: 'scroll',
      x: 960,
      y: 540,
      scrollX: 0,
      scrollY: 600,
      safetyDecision: 'require_confirmation',
    });
  });

  it('rejects unknown actions and out-of-range coordinates', () => {
    expect(() => normalizeAction({ name: 'shell', arguments: {} }, viewport)).toThrow('Action interdite');
    expect(() => normalizeAction({ name: 'click', arguments: { x: 1_001, y: 0 } }, viewport)).toThrow('x hors limites');
  });

  it('rejects shell-shaped arguments and oversized text', () => {
    expect(() => normalizeAction({ name: 'click', arguments: { x: 0, y: 0, command: 'whoami' } }, viewport)).toThrow('Argument interdit');
    expect(() => normalizeAction({ name: 'type', arguments: { text: 'x'.repeat(10_001) } }, viewport)).toThrow('Texte trop long');
  });

  it('normalizes drag endpoints, text, keys, and completion', () => {
    expect(normalizeAction({ name: 'drag', arguments: { x: 0, y: 0, end_x: 1_000, end_y: 1_000 } }, viewport)).toMatchObject({
      name: 'drag', x: 0, y: 0, endX: 1_920, endY: 1_080,
    });
    expect(normalizeAction({ name: 'type', arguments: { text: 'bonjour' } }, viewport)).toMatchObject({ name: 'type', text: 'bonjour' });
    expect(normalizeAction({ name: 'key', arguments: { keys: ['CTRL', 'A'] } }, viewport)).toMatchObject({ name: 'key', keys: ['CTRL', 'A'] });
    expect(normalizeAction({ name: 'done', arguments: { intent: 'Objectif atteint' } }, viewport)).toMatchObject({ name: 'done', intent: 'Objectif atteint' });
  });

  it('normalizes bounded text aliases and rejects an empty typing action before execution', () => {
    expect(normalizeAction({ name: 'type', arguments: { value: 'recette gâteau' } }, viewport))
      .toMatchObject({ name: 'type', text: 'recette gâteau' });
    expect(normalizeAction({ name: 'type', arguments: { text: 'Mina', replace_text: true } }, viewport))
      .toMatchObject({ name: 'type', text: 'Mina', replaceText: true });
    expect(normalizeAction({ name: 'type', arguments: { content: 'Mina Vision' } }, viewport))
      .toMatchObject({ name: 'type', text: 'Mina Vision' });
    expect(() => normalizeAction({ name: 'type', arguments: {} }, viewport)).toThrow('Texte de saisie requis');
  });

  it('rejects incomplete pointer, drag, key, scroll, and navigation actions before execution', () => {
    expect(() => normalizeAction({ name: 'click', arguments: {} }, viewport)).toThrow('Coordonnées x/y requises');
    expect(() => normalizeAction({ name: 'drag', arguments: { x: 10, y: 20 } }, viewport)).toThrow('Coordonnées de déplacement requises');
    expect(() => normalizeAction({ name: 'key', arguments: {} }, viewport)).toThrow('Touche requise');
    expect(() => normalizeAction({ name: 'scroll', arguments: {} }, viewport)).toThrow('Déplacement de scroll requis');
    expect(() => normalizeAction({ name: 'navigate', arguments: {} }, viewport)).toThrow('URL requise');
  });

  it('maps official Gemini 3.5 browser actions to internal actions', () => {
    expect(normalizeAction({ name: 'drag_and_drop', arguments: { start_x: 0, start_y: 0, end_x: 999, end_y: 999 } }, viewport)).toMatchObject({
      name: 'drag', x: 0, y: 0, endX: 1_918, endY: 1_079,
    });
    expect(normalizeAction({ name: 'press_key', arguments: { key: 'ENTER' } }, viewport)).toMatchObject({ name: 'key', keys: ['ENTER'] });
    expect(normalizeAction({ name: 'hotkey', arguments: { keys: ['CTRL', 'A'] } }, viewport)).toMatchObject({ name: 'key', keys: ['CTRL', 'A'] });
    expect(normalizeAction({ name: 'scroll', arguments: { x: 500, y: 500, direction: 'up', magnitude_in_pixels: 300 } }, viewport)).toMatchObject({
      name: 'scroll', scrollX: 0, scrollY: -300,
    });
    expect(normalizeAction({ name: 'navigate', arguments: { url: 'https://example.com' } }, viewport)).toMatchObject({ name: 'navigate', url: 'https://example.com/' });
  });

  it('rejects unsafe navigation and unknown scroll directions', () => {
    expect(() => normalizeAction({ name: 'navigate', arguments: { url: 'javascript:alert(1)' } }, viewport)).toThrow('URL interdite');
    expect(() => normalizeAction({ name: 'scroll', arguments: { direction: 'diagonal', magnitude_in_pixels: 10 } }, viewport)).toThrow('Direction de scroll invalide');
  });

  it('supports the remaining official pointer, held-key, and wait actions', () => {
    expect(normalizeAction({ name: 'triple_click', arguments: { x: 1, y: 2 } }, viewport)).toMatchObject({ name: 'triple_click' });
    expect(normalizeAction({ name: 'middle_click', arguments: { x: 1, y: 2 } }, viewport)).toMatchObject({ name: 'middle_click' });
    expect(normalizeAction({ name: 'key_down', arguments: { key: 'CTRL' } }, viewport)).toMatchObject({ name: 'key_down', keys: ['CTRL'] });
    expect(normalizeAction({ name: 'key_up', arguments: { key: 'CTRL' } }, viewport)).toMatchObject({ name: 'key_up', keys: ['CTRL'] });
    expect(normalizeAction({ name: 'wait', arguments: { seconds: 2 } }, viewport)).toMatchObject({ name: 'wait', milliseconds: 2_000 });
  });

  it('normalizes a bounded Android application component', () => {
    expect(normalizeAction({
      name: 'launch_app',
      arguments: {
        package_name: 'com.android.chrome',
        activity_name: 'com.google.android.apps.chrome.Main',
        expected_effect: { type: 'ui_state_change' },
      },
    }, viewport)).toMatchObject({
      name: 'launch_app',
      packageName: 'com.android.chrome',
      activityName: 'com.google.android.apps.chrome.Main',
    });
    expect(() => normalizeAction({
      name: 'launch_app', arguments: { package_name: 'x;rm', activity_name: 'Main' },
    }, viewport)).toThrow('Composant Android invalide');
  });

  it('preserves only supported structured expected effects', () => {
    expect(normalizeAction({
      name: 'click',
      arguments: { x: 10, y: 20, expected_effect: { type: 'ui_state_change' } },
    }, viewport)).toMatchObject({ expectedEffect: { type: 'ui_state_change' } });
    expect(() => normalizeAction({
      name: 'click',
      arguments: { x: 10, y: 20, expected_effect: { type: 'run_command' } },
    }, viewport)).toThrow('Effet attendu invalide');
  });
});
