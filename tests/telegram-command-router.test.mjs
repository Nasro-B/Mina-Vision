import { describe, expect, it, vi } from 'vitest';
import { createTelegramCommandRouter } from '../src/messaging/telegram-command-router.mjs';

function handler(claims, response = { reply: ['ok'] }) {
  return { handle: vi.fn(async ({ body }) => (claims.some((prefix) => body.startsWith(prefix)) ? response : null)) };
}

describe('createTelegramCommandRouter', () => {
  it('requires at least the conversation responder', () => {
    expect(() => createTelegramCommandRouter({})).toThrow(TypeError);
  });

  it('routes a /home command to the home handler and never reaches the conversational LLM', async () => {
    const homeCommands = handler(['/home'], { reply: ['État confirmé.'] });
    const conversation = { reply: vi.fn(async () => 'never called') };
    const router = createTelegramCommandRouter({ homeCommands, conversation });

    const result = await router.handle({ sender: '111:111', body: '/home lampe on' });

    expect(result).toEqual({ reply: ['État confirmé.'], source: 'home' });
    expect(homeCommands.handle).toHaveBeenCalledOnce();
    expect(conversation.reply).not.toHaveBeenCalled();
  });

  it('routes a /mail command to the mail handler, tried after home, before the LLM', async () => {
    const homeCommands = handler(['/home']);
    const mailCommands = handler(['/mail'], { reply: ['Mode e-mail réglé sur 2.'] });
    const conversation = { reply: vi.fn(async () => 'never called') };
    const router = createTelegramCommandRouter({ homeCommands, mailCommands, conversation });

    const result = await router.handle({ sender: '111:111', body: '/mail mode 2' });

    expect(result).toEqual({ reply: ['Mode e-mail réglé sur 2.'], source: 'mail' });
    expect(homeCommands.handle).toHaveBeenCalledOnce();
    expect(conversation.reply).not.toHaveBeenCalled();
  });

  it('falls back to the conversational LLM for anything no deterministic handler claims', async () => {
    const homeCommands = handler(['/home']);
    const mailCommands = handler(['/mail']);
    const conversation = { reply: vi.fn(async () => 'Bonjour depuis Mina.') };
    const router = createTelegramCommandRouter({ homeCommands, mailCommands, conversation });

    const result = await router.handle({ sender: '111:111', body: 'Bonjour Mina' });

    expect(result).toEqual({ reply: ['Bonjour depuis Mina.'], source: 'conversation' });
  });

  it('never calls the LLM as a fallback for a message that LOOKS like a command but was malformed', async () => {
    const homeCommands = handler(['/home'], { reply: ['Commande /home inconnue.'] });
    const conversation = { reply: vi.fn(async () => 'never called') };
    const router = createTelegramCommandRouter({ homeCommands, conversation });

    const result = await router.handle({ sender: '111:111', body: '/home this is not valid' });

    expect(result.source).toBe('home');
    expect(conversation.reply).not.toHaveBeenCalled();
  });

  it('works with only the conversation responder configured (home/mail optional)', async () => {
    const conversation = { reply: vi.fn(async () => 'Bonjour.') };
    const router = createTelegramCommandRouter({ conversation });
    await expect(router.handle({ sender: '111:111', body: 'salut' })).resolves.toEqual({ reply: ['Bonjour.'], source: 'conversation' });
  });

  it('categorically refuses code execution, skill installation and secret-reading requests, before any handler runs', async () => {
    const homeCommands = handler([]);
    const conversation = { reply: vi.fn(async () => 'never called') };
    const router = createTelegramCommandRouter({ homeCommands, conversation });

    for (const body of ['/sandbox run print(1)', '/skill install evil', '/secret GEMINI_API_KEY', 'exécute ce code python: import os']) {
      // eslint-disable-next-line no-await-in-loop
      const result = await router.handle({ sender: '111:111', body });
      expect(result.source).toBe('blocked');
      expect(conversation.reply).not.toHaveBeenCalled();
    }
  });

  it('propagates a handler error instead of silently falling through to the LLM', async () => {
    const homeCommands = { handle: vi.fn(async () => { throw new Error('home_service_unavailable'); }) };
    const conversation = { reply: vi.fn(async () => 'never called') };
    const router = createTelegramCommandRouter({ homeCommands, conversation });

    await expect(router.handle({ sender: '111:111', body: '/home lampe on' })).rejects.toThrow('home_service_unavailable');
    expect(conversation.reply).not.toHaveBeenCalled();
  });
});
