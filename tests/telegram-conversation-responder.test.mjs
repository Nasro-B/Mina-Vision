import { describe, expect, it, vi } from 'vitest';
import { createTelegramConversationResponder } from '../src/messaging/telegram-conversation-responder.mjs';

describe('telegram conversation responder', () => {
  it('asks the configured text provider for a bounded Mina Vision reply', async () => {
    const generate = vi.fn(async () => ({ output: '  Bonjour Nasro.  ' }));
    const responder = createTelegramConversationResponder({ generate });

    await expect(responder.reply({ body: 'Bonjour Mina' })).resolves.toBe('Bonjour Nasro.');
    expect(generate).toHaveBeenCalledWith({
      messages: [
        expect.objectContaining({ role: 'system', content: expect.stringContaining('Mina Vision') }),
        { role: 'user', content: 'Bonjour Mina' },
      ],
      temperature: 0.3,
    });
  });

  it('rejects invalid input and empty provider output', async () => {
    const responder = createTelegramConversationResponder({ generate: vi.fn(async () => ({ output: '   ' })) });

    await expect(responder.reply({ body: '' })).rejects.toThrow('telegram_message_invalid');
    await expect(responder.reply({ body: 'Bonjour' })).rejects.toThrow('telegram_reply_empty');
  });

  it('bounds the reply to the Telegram transport limit', async () => {
    const responder = createTelegramConversationResponder({
      generate: vi.fn(async () => ({ output: 'x'.repeat(5_000) })),
    });

    await expect(responder.reply({ body: 'Réponds' })).resolves.toHaveLength(4_096);
  });
});
