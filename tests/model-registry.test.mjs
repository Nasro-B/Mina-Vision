import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createModelRegistry } from '../src/models/model-registry.mjs';

const manifest = (overrides = {}) => ({
  id: 'mini-text-fr', role: 'text', source: 'hf://owner/model', revision: 'abc123',
  sha256: 'a'.repeat(64), license: 'apache-2.0', estimatedRamMb: 2_048,
  runtime: 'transformers-js', path: 'mini-text-fr', ...overrides,
});

describe('canonical local model registry', () => {
  it('validates unique IDs, roles, metadata, checksums and confined paths', () => {
    const root = path.resolve('C:\\MinaData\\models');
    expect(() => createModelRegistry({ workspaceRoot: root, manifests: [manifest(), manifest()] }))
      .toThrow('model_manifest_duplicate');
    for (const invalid of [
      manifest({ role: 'image-magic' }), manifest({ sha256: '' }), manifest({ license: '' }),
      manifest({ path: '..\\escape' }), manifest({ estimatedRamMb: 0 }),
    ]) {
      expect(() => createModelRegistry({ workspaceRoot: root, manifests: [invalid] })).toThrow();
    }
  });

  it('tracks missing, installed, loaded and failed states with immutable snapshots', () => {
    const root = path.resolve('C:\\MinaData\\models');
    const registry = createModelRegistry({ workspaceRoot: root, manifests: [manifest()], clock: () => 100 });
    expect(registry.list()[0]).toMatchObject({ id: 'mini-text-fr', state: 'missing' });
    expect(() => registry.markLoaded('mini-text-fr')).toThrow('model_state_transition_invalid');

    registry.markInstalled('mini-text-fr', path.join(root, 'mini-text-fr'));
    expect(registry.resolve('text')).toMatchObject({ id: 'mini-text-fr', state: 'installed' });
    registry.markLoaded('mini-text-fr');
    expect(registry.resolve('text').state).toBe('loaded');
    registry.markFailed('mini-text-fr', new Error('runtime crash'));
    expect(registry.list()[0]).toMatchObject({ state: 'failed', error: 'runtime crash' });
    expect(Object.isFrozen(registry.list()[0])).toBe(true);
  });

  it('resolves an installed model by role and RAM constraints without hardcoded IDs', () => {
    const root = path.resolve('C:\\MinaData\\models');
    const registry = createModelRegistry({
      workspaceRoot: root,
      manifests: [manifest(), manifest({ id: 'large-text', path: 'large-text', estimatedRamMb: 8_000, runtime: 'lm-studio' })],
    });
    registry.markInstalled('mini-text-fr', path.join(root, 'mini-text-fr'));
    registry.markInstalled('large-text', path.join(root, 'large-text'));

    expect(registry.resolve('text', { maxRamMb: 4_000 }).id).toBe('mini-text-fr');
    expect(() => registry.resolve('ocr')).toThrow('model_role_unavailable:ocr');
  });
});
