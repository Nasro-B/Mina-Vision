import { describe, expect, it, vi } from 'vitest';
import { createChatResponder } from '../src/devices/chat-responder.mjs';

const baseInput = { text: 'bonjour', deviceId: 'device-samsung', threadId: 'thread-main', eventId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' };

describe('réponse de Mina sur le canal mina_app', () => {
  it('répond et retient l\'échange complet', async () => {
    const memory = {
      recentConversation: vi.fn(async () => [{ role: 'owner', content: 'hier on parlait des courses' }]),
      rememberChatExchange: vi.fn(async () => ({ remembered: true })),
    };
    const generate = vi.fn(async () => ({ output: 'bonjour Nasro' }));
    const respond = createChatResponder({ generate, memory });

    expect(await respond(baseInput)).toBe('bonjour Nasro');
    expect(memory.rememberChatExchange).toHaveBeenCalledWith(expect.objectContaining({
      eventId: baseInput.eventId,
      deviceId: 'device-samsung',
      userMessage: 'bonjour',
      assistantMessage: 'bonjour Nasro',
    }));
  });

  it('annonce le périmètre du canal dans la consigne système', async () => {
    const generate = vi.fn(async () => ({ output: 'ok' }));
    await createChatResponder({ generate })(baseInput);
    const system = generate.mock.calls[0][0].messages[0].content;
    expect(system).toContain('conversation, mémoire et médias uniquement');
    expect(system).toContain('confirmée sur le PC');
  });

  it('reprend le contexte récent quand la mémoire est ouverte', async () => {
    const generate = vi.fn(async () => ({ output: 'ok' }));
    const memory = { recentConversation: async () => [{ role: 'owner', content: 'rappel important' }] };
    await createChatResponder({ generate, memory })(baseInput);
    expect(JSON.stringify(generate.mock.calls[0][0].messages)).toContain('rappel important');
  });

  it('répond quand même si la mémoire est verrouillée — sans prétendre se souvenir', async () => {
    const generate = vi.fn(async () => ({ output: 'réponse sans mémoire' }));
    const memory = {
      recentConversation: async () => { throw new Error('memory_locked'); },
      rememberChatExchange: async () => { throw new Error('memory_locked'); },
    };
    const respond = createChatResponder({ generate, memory });
    expect(await respond(baseInput)).toBe('réponse sans mémoire');
    expect(JSON.stringify(generate.mock.calls[0][0].messages)).not.toContain('Contexte récent');
  });

  it('refuse un message vide, trop long ou contenant un octet nul', async () => {
    const respond = createChatResponder({ generate: async () => ({ output: 'ok' }) });
    await expect(respond({ ...baseInput, text: '' })).rejects.toThrow('chat_message_invalide');
    await expect(respond({ ...baseInput, text: 'a'.repeat(4_097) })).rejects.toThrow('chat_message_invalide');
    await expect(respond({ ...baseInput, text: 'salut\0' })).rejects.toThrow('chat_message_invalide');
  });

  it('refuse de renvoyer une réponse vide plutôt que d\'afficher un blanc', async () => {
    const respond = createChatResponder({ generate: async () => ({ output: '   ' }) });
    await expect(respond(baseInput)).rejects.toThrow('chat_reponse_vide');
  });

  it('transmet les deltas natifs et retient exactement le final streamé une seule fois', async () => {
    const memory = { rememberChatExchange: vi.fn(async () => ({ remembered: true })) };
    const onDelta = vi.fn(async () => {});
    const generate = vi.fn(async ({ stream, onDelta: providerDelta }) => {
      expect(stream).toBe(true);
      await providerDelta('bonjour ');
      return { output: 'bonjour ' };
    });
    const respond = createChatResponder({ generate, memory });

    await expect(respond({ ...baseInput, onDelta })).resolves.toBe('bonjour ');
    expect(onDelta).toHaveBeenCalledWith('bonjour ');
    expect(memory.rememberChatExchange).toHaveBeenCalledTimes(1);
    expect(memory.rememberChatExchange).toHaveBeenCalledWith(expect.objectContaining({ assistantMessage: 'bonjour ' }));
  });
});
