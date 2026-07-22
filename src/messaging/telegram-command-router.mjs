// Routes an inbound Telegram message: deterministic slash commands are tried FIRST (home, mail —
// each already enforces its own owner check and audit), and the conversational LLM is only ever
// reached for whatever no deterministic handler claims. This ordering IS the security boundary:
// the LLM never receives a body that could be interpreted as an action request, and it is never
// given tools, so "the model hallucinated an action" is structurally impossible on this channel.
const BLOCKED_PATTERNS = [
  /^\/sandbox\b/iu, /^\/skill\s+(install|remove)/iu, /^\/secret\b/iu,
  /ex[ée]cute(r)?\s+(ce\s+)?(code|script)/iu, /installe(r)?\s+(un\s+|ce\s+)?skill/iu,
];

export function createTelegramCommandRouter({ homeCommands = null, mailCommands = null, conversation } = {}) {
  if (!conversation?.reply) throw new TypeError('telegram_command_router_conversation_required');

  async function handle({ sender, body } = {}) {
    const text = String(body ?? '');
    if (BLOCKED_PATTERNS.some((pattern) => pattern.test(text))) {
      return Object.freeze({ reply: ["Cette action n'est pas autorisée depuis Telegram."], source: 'blocked' });
    }
    if (homeCommands) {
      const result = await homeCommands.handle({ sender, body: text });
      if (result) return Object.freeze({ ...result, source: 'home' });
    }
    if (mailCommands) {
      const result = await mailCommands.handle({ sender, body: text });
      if (result) return Object.freeze({ ...result, source: 'mail' });
    }
    const reply = await conversation.reply({ sender, body: text });
    return Object.freeze({ reply: [reply], source: 'conversation' });
  }

  return Object.freeze({ handle });
}
