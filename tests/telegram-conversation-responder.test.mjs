import { describe, expect, it, vi } from 'vitest';
import { createTelegramConversationResponder } from '../src/messaging/telegram-conversation-responder.mjs';

describe('telegram conversation responder', () => {
  it('delegates bounded Telegram input to the grounded response gate', async () => {
    const generate = vi.fn(async () => ({ output: 'ce texte ne doit pas être envoyé brut' }));
    const groundedResponse = { reply: vi.fn(async () => ({ text: 'Bonjour Nasro.' })) };
    const responder = createTelegramConversationResponder({ generate, groundedResponse });
    const evidence = [{ sourceId: 'evidence-1' }];

    await expect(responder.reply({ body: 'Bonjour Mina', evidence, workSessionId: 'work-1' })).resolves.toBe('Bonjour Nasro.');
    expect(groundedResponse.reply).toHaveBeenCalledWith({
      generate,
      messages: [
        expect.objectContaining({ role: 'system', content: expect.stringContaining('Mina Vision') }),
        { role: 'user', content: 'Bonjour Mina' },
      ],
      evidence,
      workSessionId: 'work-1',
      channel: 'telegram',
      maxOutput: 4_096,
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects invalid input and a missing grounding service', async () => {
    const responder = createTelegramConversationResponder({
      generate: vi.fn(async () => ({ output: '   ' })),
      groundedResponse: { reply: vi.fn(async () => ({ text: 'Réponse.' })) },
    });

    await expect(responder.reply({ body: '' })).rejects.toThrow('telegram_message_invalid');
    expect(() => createTelegramConversationResponder({ generate: vi.fn() })).toThrow('telegram_grounded_response_required');
  });

  it('rejects a grounded result outside the Telegram transport limit', async () => {
    const responder = createTelegramConversationResponder({
      generate: vi.fn(async () => ({ output: 'texte brut non utilisé' })),
      groundedResponse: { reply: vi.fn(async () => ({ text: 'x'.repeat(5_000) })) },
    });

    await expect(responder.reply({ body: 'Réponds', evidence: [], workSessionId: 'work-1' }))
      .rejects.toThrow('telegram_grounded_reply_invalid');
  });
});
