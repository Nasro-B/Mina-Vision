import { describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleComputerUseProvider } from '../src/providers/openai-compatible-computer-use.mjs';

const observation = Object.freeze({
  imageBase64: Buffer.from('screenshot').toString('base64'),
  mimeType: 'image/png',
  width: 1_000,
  height: 800,
  url: 'https://www.youtube.com/',
});

function clientReturning(content) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({ choices: [{ message: { content } }] }),
      },
    },
  };
}

describe('OpenAI-compatible Computer Use provider', () => {
  it('requests a strict structured vision action and validates it with normalizeAction', async () => {
    const client = clientReturning(JSON.stringify({
      completed: false,
      text: 'Je saisis la recherche.',
      action: {
        name: 'type',
        arguments_json: JSON.stringify({
          text: 'recette gâteau',
          expected_effect: { type: 'ui_state_change' },
        }),
      },
    }));
    const provider = createOpenAiCompatibleComputerUseProvider({
      id: 'openrouter-computer-use',
      client,
      model: 'openrouter/auto-beta',
    });

    const result = await provider.invoke({
      operation: 'start',
      goal: 'Cherche une recette de gâteau sur YouTube',
      environment: 'browser',
      observation,
    });

    expect(result).toMatchObject({
      completed: false,
      modelId: 'openrouter/auto-beta',
      calls: [{ name: 'type', arguments: { text: 'recette gâteau' } }],
    });
    expect(client.chat.completions.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openrouter/auto-beta',
      response_format: expect.objectContaining({ type: 'json_schema' }),
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([
            expect.objectContaining({ type: 'image_url' }),
          ]),
        }),
      ]),
    }));
  });

  it('sends bounded DOM grounding coordinates with the screenshot', async () => {
    const client = clientReturning(JSON.stringify({
      completed: false,
      text: 'Je clique.',
      action: {
        name: 'click',
        arguments_json: JSON.stringify({ x: 500, y: 72, expected_effect: 'ui_state_change' }),
      },
    }));
    const provider = createOpenAiCompatibleComputerUseProvider({ id: 'vision', client, model: 'vision' });

    await provider.start({
      goal: 'Clique la recherche',
      environment: 'browser',
      observation: {
        ...observation,
        elements: [{ tag: 'input', type: 'text', label: 'Rechercher', x: 500, y: 72 }],
      },
    });

    const userText = client.chat.completions.create.mock.calls[0][0].messages[1].content[0].text;
    expect(JSON.parse(userText).elements).toEqual([
      { tag: 'input', type: 'text', label: 'Rechercher', x: 500, y: 72 },
    ]);
  });

  it('grounds a typing action to the sole visible editable element', async () => {
    const client = clientReturning(JSON.stringify({
      completed: false,
      text: 'Je saisis.',
      action: {
        name: 'type',
        arguments_json: JSON.stringify({ text: 'recette gâteau', expected_effect: 'ui_state_change' }),
      },
    }));
    const provider = createOpenAiCompatibleComputerUseProvider({ id: 'vision', client, model: 'vision' });

    await expect(provider.start({
      goal: 'Saisis la recherche',
      environment: 'browser',
      observation: {
        ...observation,
        elements: [{ tag: 'input', type: 'text', label: 'Rechercher', x: 464, y: 31 }],
      },
    })).resolves.toMatchObject({
      calls: [{ arguments: { text: 'recette gâteau', x: 464, y: 31, replace_text: true } }],
    });
  });

  it('ends a loop instead of submitting the same successful typing action twice', async () => {
    const repeated = JSON.stringify({
      completed: false,
      text: 'Je saisis.',
      action: {
        name: 'type',
        arguments_json: JSON.stringify({
          text: 'recette gâteau', press_enter: true, expected_effect: 'ui_state_change',
        }),
      },
    });
    const client = clientReturning(repeated);
    const provider = createOpenAiCompatibleComputerUseProvider({ id: 'vision', client, model: 'vision' });
    const first = await provider.start({
      goal: 'Lance la recherche', environment: 'browser', observation,
    });

    await expect(provider.continue({
      interactionId: first.interactionId,
      call: first.calls[0],
      actionResult: { executed: true, url: 'https://www.youtube.com/results?search_query=recette' },
      environment: 'browser',
      observation: { ...observation, url: 'https://www.youtube.com/results?search_query=recette' },
    })).resolves.toMatchObject({ completed: true, calls: [] });
  });

  it('keeps the goal across turns and returns a completed response', async () => {
    const client = clientReturning(JSON.stringify({ completed: true, text: 'Terminé.', action: null }));
    const provider = createOpenAiCompatibleComputerUseProvider({
      id: 'modal-computer-use', client, model: 'Qwen/Qwen3.5-9B',
    });

    const result = await provider.invoke({
      operation: 'start', goal: 'Ouvre YouTube', environment: 'browser', observation,
    });

    expect(result).toMatchObject({ completed: true, text: 'Terminé.', calls: [] });
  });

  it('rejects prose, unknown actions, and shell-shaped arguments', async () => {
    const prose = createOpenAiCompatibleComputerUseProvider({
      id: 'bad-prose', client: clientReturning('Clique ici'), model: 'vision',
    });
    await expect(prose.invoke({
      operation: 'start', goal: 'test', environment: 'browser', observation,
    })).rejects.toThrow('computer_use_json_required');

    const shell = createOpenAiCompatibleComputerUseProvider({
      id: 'bad-shell',
      client: clientReturning(JSON.stringify({
        completed: false,
        text: '',
        action: {
          name: 'click',
          arguments_json: JSON.stringify({ command: 'whoami', expected_effect: { type: 'ui_state_change' } }),
        },
      })),
      model: 'vision',
    });
    await expect(shell.invoke({
      operation: 'start', goal: 'test', environment: 'browser', observation,
    })).rejects.toThrow('Argument interdit');
  });

  it('normalizes a model that returns expected_effect as an allowed scalar', async () => {
    const provider = createOpenAiCompatibleComputerUseProvider({
      id: 'openrouter-computer-use',
      client: clientReturning(JSON.stringify({
        completed: false,
        text: 'Je clique.',
        action: {
          name: 'click',
          arguments_json: JSON.stringify({ x: 500, y: 100, expected_effect: 'ui_state_change' }),
        },
      })),
      model: 'openrouter/free',
    });

    await expect(provider.invoke({
      operation: 'start', goal: 'test', environment: 'browser', observation,
    })).resolves.toMatchObject({
      calls: [{ arguments: { expected_effect: { type: 'ui_state_change' } } }],
    });
  });

  it('repairs one malformed model action before returning it to the orchestrator', async () => {
    const invalid = JSON.stringify({
      completed: false,
      text: 'Je saisis la recherche.',
      action: {
        name: 'type',
        arguments_json: JSON.stringify({ expected_effect: 'ui_state_change' }),
      },
    });
    const valid = JSON.stringify({
      completed: false,
      text: 'Je saisis la recherche.',
      action: {
        name: 'type',
        arguments_json: JSON.stringify({ value: 'recette gâteau', expected_effect: 'ui_state_change' }),
      },
    });
    const client = clientReturning(invalid);
    client.chat.completions.create
      .mockResolvedValueOnce({ choices: [{ message: { content: invalid } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: valid } }] });
    const provider = createOpenAiCompatibleComputerUseProvider({
      id: 'openrouter-computer-use', client, model: 'openrouter/free',
    });

    await expect(provider.invoke({
      operation: 'start', goal: 'test', environment: 'browser', observation,
    })).resolves.toMatchObject({ calls: [{ arguments: { value: 'recette gâteau' } }] });
    expect(client.chat.completions.create).toHaveBeenCalledTimes(2);
    expect(client.chat.completions.create.mock.calls[1][0].messages.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('Texte de saisie requis'),
    });
  });

  it('adds Modal proxy headers without putting them in the request body', async () => {
    const instances = [];
    const provider = createOpenAiCompatibleComputerUseProvider({
      id: 'modal-computer-use',
      apiKey: 'unused',
      baseURL: 'https://example.modal.direct/v1',
      model: 'Qwen/Qwen3.5-9B',
      defaultHeaders: { 'Modal-Key': 'id', 'Modal-Secret': 'secret' },
      clientFactory: (options) => {
        instances.push(options);
        return clientReturning(JSON.stringify({ completed: true, text: 'ok', action: null }));
      },
    });

    await provider.invoke({ operation: 'start', goal: 'test', environment: 'browser', observation });

    expect(instances[0]).toMatchObject({
      baseURL: 'https://example.modal.direct/v1',
      defaultHeaders: { 'Modal-Key': 'id', 'Modal-Secret': 'secret' },
    });
    const request = instances.length && instances[0];
    expect(JSON.stringify(request)).not.toContain('messages');
  });

  it('supports a text-only browser planner without sending the screenshot', async () => {
    const client = clientReturning(JSON.stringify({ completed: true, text: 'Terminé.', action: null }));
    const provider = createOpenAiCompatibleComputerUseProvider({
      id: 'modal-browser-planner', client, model: 'Qwen/Qwen3.5-9B',
      includeImage: false, environments: ['browser'],
    });

    await provider.start({ goal: 'Observe la page', environment: 'browser', observation });

    const content = client.chat.completions.create.mock.calls[0][0].messages[1].content;
    expect(content).toEqual([expect.objectContaining({ type: 'text' })]);
    await expect(provider.start({ goal: 'Observe le bureau', environment: 'desktop', observation }))
      .rejects.toThrow('computer_use_environment_unsupported');
  });
});
