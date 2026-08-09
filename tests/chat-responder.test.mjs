import { describe, expect, it, vi } from 'vitest';
import { createChatResponder } from '../src/devices/chat-responder.mjs';

const baseInput = { text: 'bonjour', deviceId: 'device-samsung', threadId: 'thread-main', eventId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' };

describe('réponse de Mina sur le canal mina_app', () => {
  it('répond et retient l\'échange complet', async () => {
    const memory = {
      recentConversation: vi.fn(async () => [{ role: 'owner', content: 'hier on parlait des courses' }]),
      rememberChatExchange: vi.fn(async () => ({ remembered: true })),
    };
    const groundedResponse = { reply: vi.fn(async () => ({ text: 'bonjour Nasro' })) };
    const respond = createChatResponder({ groundedResponse, memory });

    expect(await respond({ ...baseInput, evidence: [{ sourceId: 'evidence-1' }], workSessionId: 'work-1' })).toBe('bonjour Nasro');
    expect(groundedResponse.reply).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        expect.objectContaining({ role: 'system', content: expect.stringContaining('Mina Vision') }),
        expect.objectContaining({ role: 'system', content: expect.stringContaining('hier on parlait des courses') }),
        { role: 'user', content: 'bonjour' },
      ],
      evidence: [{ sourceId: 'evidence-1' }],
      workSessionId: 'work-1',
      channel: 'mina_app',
      maxOutput: 4_096,
    }));
    expect(memory.rememberChatExchange).toHaveBeenCalledWith(expect.objectContaining({
      eventId: baseInput.eventId,
      deviceId: 'device-samsung',
      userMessage: 'bonjour',
      assistantMessage: 'bonjour Nasro',
    }));
  });

  it('annonce le périmètre du canal dans la consigne système', async () => {
    const groundedResponse = { reply: vi.fn(async () => ({ text: 'ok' })) };
    await createChatResponder({ groundedResponse })({ ...baseInput, evidence: [], workSessionId: 'work-1' });
    const system = groundedResponse.reply.mock.calls[0][0].messages[0].content;
    expect(system).toContain('conversation, mémoire et médias uniquement');
    expect(system).toContain('confirmée sur le PC');
  });

  it('reprend le contexte récent quand la mémoire est ouverte', async () => {
    const groundedResponse = { reply: vi.fn(async () => ({ text: 'ok' })) };
    const memory = { recentConversation: async () => [{ role: 'owner', content: 'rappel important' }] };
    await createChatResponder({ groundedResponse, memory })({ ...baseInput, evidence: [], workSessionId: 'work-1' });
    expect(JSON.stringify(groundedResponse.reply.mock.calls[0][0].messages)).toContain('rappel important');
  });

  it('répond quand même si la mémoire est verrouillée — sans prétendre se souvenir', async () => {
    const groundedResponse = { reply: vi.fn(async () => ({ text: 'réponse sans mémoire' })) };
    const memory = {
      recentConversation: async () => { throw new Error('memory_locked'); },
      rememberChatExchange: async () => { throw new Error('memory_locked'); },
    };
    const respond = createChatResponder({ groundedResponse, memory });
    expect(await respond({ ...baseInput, evidence: [], workSessionId: 'work-1' })).toBe('réponse sans mémoire');
    expect(JSON.stringify(groundedResponse.reply.mock.calls[0][0].messages)).not.toContain('Contexte récent');
  });

  it('refuse un message vide, trop long ou contenant un octet nul', async () => {
    const respond = createChatResponder({ groundedResponse: { reply: async () => ({ text: 'ok' }) } });
    await expect(respond({ ...baseInput, text: '' })).rejects.toThrow('chat_message_invalide');
    await expect(respond({ ...baseInput, text: 'a'.repeat(4_097) })).rejects.toThrow('chat_message_invalide');
    await expect(respond({ ...baseInput, text: 'salut\0' })).rejects.toThrow('chat_message_invalide');
  });

  it('refuse une réponse groundée vide plutôt que d\'afficher un blanc', async () => {
    const respond = createChatResponder({ groundedResponse: { reply: async () => ({ text: '   ' }) } });
    await expect(respond({ ...baseInput, evidence: [], workSessionId: 'work-1' })).rejects.toThrow('chat_reponse_vide');
  });

  it('tamponne les deltas jusqu\'au résultat groundé final', async () => {
    const memory = { rememberChatExchange: vi.fn(async () => ({ remembered: true })) };
    const onDelta = vi.fn(async () => {});
    const groundedResponse = { reply: vi.fn(async () => ({ text: 'bonjour final' })) };
    const respond = createChatResponder({ groundedResponse, memory });

    await expect(respond({ ...baseInput, evidence: [], workSessionId: 'work-1', onDelta })).resolves.toBe('bonjour final');
    expect(onDelta).not.toHaveBeenCalled();
    expect(groundedResponse.reply.mock.calls[0][0]).not.toHaveProperty('onDelta');
    expect(memory.rememberChatExchange).toHaveBeenCalledTimes(1);
    expect(memory.rememberChatExchange).toHaveBeenCalledWith(expect.objectContaining({ assistantMessage: 'bonjour final' }));
  });

  it('retient uniquement la réponse sûre du gate, jamais un texte brut de fournisseur', async () => {
    const memory = { rememberChatExchange: vi.fn(async () => ({ remembered: true })) };
    const groundedResponse = {
      reply: vi.fn(async () => ({ text: 'Je ne peux pas fournir une réponse factuelle vérifiée avec les preuves disponibles.' })),
    };
    const respond = createChatResponder({ groundedResponse, memory });

    await expect(respond({ ...baseInput, evidence: [], workSessionId: 'work-1' }))
      .resolves.toBe('Je ne peux pas fournir une réponse factuelle vérifiée avec les preuves disponibles.');
    expect(memory.rememberChatExchange).toHaveBeenCalledWith(expect.objectContaining({
      assistantMessage: 'Je ne peux pas fournir une réponse factuelle vérifiée avec les preuves disponibles.',
    }));
  });

  it('requires the grounded response service', () => {
    expect(() => createChatResponder({})).toThrow('chat_responder_grounded_response_requis');
  });
});
