import { describe, expect, it, vi } from 'vitest';
import { createLocalComputerUseProvider } from '../src/providers/local-computer-use.mjs';

const observation = {
  imageBase64: 'cG5n', mimeType: 'image/png', width: 1_000, height: 800,
  url: 'http://127.0.0.1:3000/',
};

function setup(outputs) {
  const plan = vi.fn();
  for (const output of outputs) plan.mockResolvedValueOnce(output);
  const modelRegistry = { resolve: vi.fn(() => ({ id: 'local-cu-1' })) };
  const modelLoader = { load: vi.fn(async () => ({ plan })) };
  const provider = createLocalComputerUseProvider({
    modelRegistry,
    modelLoader,
    idFactory: () => 'interaction-local-1',
  });
  return { provider, plan, modelRegistry, modelLoader };
}

function action(name = 'click', args = { x: 500, y: 250 }) {
  return JSON.stringify({
    completed: false,
    text: '',
    action: { name, arguments: args },
    expectedEffect: { type: 'ui_state_change' },
  });
}

describe('local Computer Use provider', () => {
  it('implements start/continue and emits the shared strict action vocabulary', async () => {
    const { provider, plan, modelLoader } = setup([
      action(),
      JSON.stringify({ completed: true, text: 'Terminé' }),
    ]);

    const first = await provider.start({ goal: 'Clique', environment: 'browser', observation });
    const second = await provider.continue({
      interactionId: first.interactionId,
      call: first.calls[0],
      actionResult: { executed: true },
      observation: { ...observation, imageBase64: 'Y2hhbmdlZA==' },
      environment: 'browser',
    });

    expect(first).toMatchObject({
      interactionId: 'interaction-local-1',
      completed: false,
      calls: [{ name: 'click', arguments: { x: 500, y: 250, expected_effect: { type: 'ui_state_change' } } }],
      modelId: 'local-cu-1',
    });
    expect(second).toMatchObject({ completed: true, text: 'Terminé', calls: [] });
    expect(modelLoader.load).toHaveBeenCalledWith('computer-use');
    expect(plan).toHaveBeenNthCalledWith(1, expect.objectContaining({ phase: 'start', goal: 'Clique' }));
    expect(plan).toHaveBeenNthCalledWith(2, expect.objectContaining({ phase: 'continue', actionResult: { executed: true } }));
  });

  it.each([
    ['prose around JSON', `Voici l'action: ${action()}`, 'local_computer_use_json_required'],
    ['unknown operation', action('shell', {}), 'Action interdite'],
    ['out of bounds', action('click', { x: 1_001, y: 0 }), 'x hors limites'],
    ['missing effect', JSON.stringify({ completed: false, action: { name: 'click', arguments: { x: 1, y: 2 } } }), 'expected_effect_required'],
  ])('rejects %s', async (_case, output, error) => {
    const { provider } = setup([output]);
    await expect(provider.start({ goal: 'test', environment: 'browser', observation })).rejects.toThrow(error);
  });

  it('rejects oversized output and unknown interactions', async () => {
    const { provider } = setup(['x'.repeat(20_000)]);
    await expect(provider.start({ goal: 'test', environment: 'browser', observation }))
      .rejects.toThrow('local_computer_use_output_too_large');
    await expect(provider.continue({
      interactionId: 'missing', call: {}, actionResult: {}, observation, environment: 'browser',
    })).rejects.toThrow('local_interaction_unknown');
  });
});
