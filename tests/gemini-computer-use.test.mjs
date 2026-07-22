import { describe, expect, it, vi } from 'vitest';
import { createComputerUseClient } from '../src/providers/gemini-computer-use.mjs';

describe('Gemini Computer Use adapter', () => {
  it('always enables prompt injection detection', async () => {
    const transport = vi.fn().mockResolvedValue({
      id: 'i1',
      steps: [{ type: 'function_call', id: 'c1', name: 'click', arguments: { x: 10, y: 20 } }],
    });
    const client = createComputerUseClient({ apiKey: 'x', transport });

    const result = await client.start({
      goal: 'click test',
      environment: 'browser',
      observation: { imageBase64: 'AA==', mimeType: 'image/png' },
    });

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.5-flash',
      input: [
        { type: 'text', text: 'click test' },
        { type: 'image', data: 'AA==', mime_type: 'image/png' },
      ],
      tools: [{ type: 'computer_use', environment: 'browser', enable_prompt_injection_detection: true }],
    }));
    expect(result.calls[0]).toMatchObject({ id: 'c1', name: 'click' });
  });

  it('continues with an official function_result payload', async () => {
    const transport = vi.fn().mockResolvedValue({ id: 'i2', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Terminé' }] }] });
    const client = createComputerUseClient({ apiKey: 'x', transport });

    const result = await client.continue({
      interactionId: 'i1',
      call: { id: 'c1', name: 'click' },
      actionResult: { executed: true, safetyAcknowledgement: true },
      observation: { imageBase64: 'BB==', mimeType: 'image/png', url: 'https://example.com/' },
      environment: 'browser',
    });

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      previous_interaction_id: 'i1',
      input: [expect.objectContaining({ type: 'function_result', name: 'click', call_id: 'c1' })],
    }));
    expect(result).toMatchObject({ interactionId: 'i2', completed: true, text: 'Terminé' });
  });

  it('keeps referenced evidence separate from the user goal', async () => {
    const transport = vi.fn().mockResolvedValue({
      id: 'i1', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Terminé' }] }],
    });
    const client = createComputerUseClient({ apiKey: 'x', transport });
    const evidence = [{
      sourceId: 'memory-1', locator: 'memory://owner/1', capturedAt: '2026-07-15T10:00:00.000Z',
      contentDigest: `sha256:${'a'.repeat(64)}`, freshnessClass: 'historical', extract: 'Mardi à 14 h', method: 'memory_recall',
    }];

    await client.start({
      goal: 'Quand ?', evidence, environment: 'browser',
      observation: { imageBase64: 'AA==', mimeType: 'image/png' },
    });

    const { input } = transport.mock.calls[0][0];
    expect(input[0]).toEqual({ type: 'text', text: 'Quand ?' });
    expect(input[1]).toEqual(expect.objectContaining({ type: 'text' }));
    expect(input[1].text).toContain('memory-1');
    expect(input[1].text).not.toContain('Quand ?');
    expect(input[2]).toEqual({ type: 'image', data: 'AA==', mime_type: 'image/png' });
  });

  it('rejects empty responses', async () => {
    const client = createComputerUseClient({ apiKey: 'x', transport: vi.fn().mockResolvedValue({ id: 'i1', steps: [] }) });
    await expect(client.start({ goal: 'x', environment: 'desktop', observation: { imageBase64: 'AA==', mimeType: 'image/png' } })).rejects.toThrow('Réponse Gemini vide');
  });
});

describe('Gemini Computer Use adapter: mid-mission guidance', () => {
  it('appends the owner guidance as a user text input after the function_result', async () => {
    const transport = vi.fn().mockResolvedValue({ id: 'i2', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'ok' }] }] });
    const client = createComputerUseClient({ apiKey: 'x', transport });

    await client.continue({
      interactionId: 'i1',
      call: { id: 'c1', name: 'click' },
      actionResult: { executed: true },
      observation: { imageBase64: 'BB==', mimeType: 'image/png', url: 'https://example.com/' },
      environment: 'browser',
      guidance: 'cherche la météo à Alger',
    });

    const payload = transport.mock.calls[0][0];
    expect(payload.input).toHaveLength(2);
    expect(payload.input[1].type).toBe('text');
    expect(payload.input[1].text).toContain('cherche la météo à Alger');
    expect(payload.input[1].text).toMatch(/mission en cours/iu);
    expect(payload.input[1].text).toMatch(/souris|clavier/iu);
  });

  it('sends no extra input when there is no guidance', async () => {
    const transport = vi.fn().mockResolvedValue({ id: 'i2', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'ok' }] }] });
    const client = createComputerUseClient({ apiKey: 'x', transport });

    await client.continue({
      interactionId: 'i1',
      call: { id: 'c1', name: 'click' },
      actionResult: { executed: true },
      observation: { imageBase64: 'BB==', mimeType: 'image/png' },
      environment: 'browser',
    });

    expect(transport.mock.calls[0][0].input).toHaveLength(1);
  });
});
