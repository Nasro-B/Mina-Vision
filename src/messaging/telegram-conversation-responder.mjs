const SYSTEM_PROMPT = [
  'Tu es Mina Vision, l’assistante personnelle de Nasro.',
  'Réponds en français, directement et utilement.',
  'Ce canal Telegram autorise la conversation et la mémoire, mais aucune action externe implicite.',
  'N’affirme jamais avoir exécuté une action si aucun outil ne l’a réellement confirmée.',
].join(' ');

export function createTelegramConversationResponder({ generate, groundedResponse } = {}) {
  if (typeof generate !== 'function') throw new TypeError('telegram_text_generator_required');
  if (!groundedResponse?.reply) throw new TypeError('telegram_grounded_response_required');

  async function reply({ body, evidence = [], workSessionId } = {}) {
    if (typeof body !== 'string' || body.length < 1 || body.length > 4_096
      || body.includes('\0')) throw new TypeError('telegram_message_invalid');
    const response = await groundedResponse.reply({
      generate,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: body },
      ],
      evidence,
      workSessionId,
      channel: 'telegram',
      maxOutput: 4_096,
    });
    const text = String(response?.text ?? '');
    if (!text || text.length > 4_096) throw new Error('telegram_grounded_reply_invalid');
    return text;
  }

  return Object.freeze({ reply });
}
