const SYSTEM_PROMPT = [
  'Tu es Mina Vision, l’assistante personnelle de Nasro.',
  'Réponds en français, directement et utilement.',
  'Ce canal Telegram autorise la conversation et la mémoire, mais aucune action externe implicite.',
  'N’affirme jamais avoir exécuté une action si aucun outil ne l’a réellement confirmée.',
].join(' ');

export function createTelegramConversationResponder({ generate } = {}) {
  if (typeof generate !== 'function') throw new TypeError('telegram_text_generator_required');

  async function reply(message = {}) {
    if (typeof message.body !== 'string' || message.body.length < 1 || message.body.length > 4_096
      || message.body.includes('\0')) throw new TypeError('telegram_message_invalid');
    const response = await generate({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message.body },
      ],
      temperature: 0.3,
    });
    const text = String(response?.output ?? '').trim().slice(0, 4_096);
    if (!text) throw new Error('telegram_reply_empty');
    return text;
  }

  return Object.freeze({ reply });
}
