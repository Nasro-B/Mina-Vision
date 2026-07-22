import { describe, expect, it, vi } from 'vitest';
import { createCompositeSkillRuntime } from '../src/skills/composite-runtime.mjs';

const bundled = Object.freeze({ slug: 'research-summary', name: 'research-summary', version: '1.0.0' });
const installed = Object.freeze({ slug: 'research-summary', name: 'research-summary', version: '2.0.0' });
const file = Object.freeze({ slug: 'file-analysis', name: 'file-analysis', version: '1.0.0' });

describe('composite skill runtime', () => {
  it('merges bundled and installed skills while letting an installed version override the bundled one', async () => {
    const primaryRegistry = { scan: vi.fn(async () => [installed]), list: vi.fn(() => [installed]) };
    const bundledRegistry = { scan: vi.fn(async () => [bundled, file]), list: vi.fn(() => [bundled, file]) };
    const primaryLoader = { load: vi.fn(async () => ({ ...installed, body: 'installed' })) };
    const bundledLoader = { load: vi.fn(async (slug) => ({ ...(slug === file.slug ? file : bundled), body: 'bundled' })) };
    const runtime = createCompositeSkillRuntime({ primaryRegistry, primaryLoader, bundledRegistry, bundledLoader });

    await runtime.refresh();

    expect(runtime.registry.list()).toEqual([file, installed]);
    expect(runtime.registry.get('research-summary')).toBe(installed);
    await expect(runtime.loader.load('research-summary')).resolves.toMatchObject({ body: 'installed' });
    await expect(runtime.loader.load('file-analysis')).resolves.toMatchObject({ body: 'bundled' });
  });
});
