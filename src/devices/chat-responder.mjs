// Réponse de Mina sur le canal `mina_app`.
//
// Périmètre fixé par la constitution (MINA.md) : conversation, mémoire et médias — aucune action
// externe implicite. Une action sensible demandée depuis le téléphone doit passer par une
// confirmation locale sur le PC, jamais par ce chemin.

const SYSTEM_PROMPT = [
  'Tu es Mina Vision, l’assistante personnelle de Nasro.',
  'Réponds en français, directement et utilement.',
  'Ce canal est l’application Mina sur un appareil appairé : conversation, mémoire et médias uniquement.',
  'Aucune action externe implicite : n’affirme jamais avoir exécuté une action si aucun outil ne l’a réellement confirmée.',
  'Si une demande exige une action sensible, dis qu’elle doit être confirmée sur le PC.',
].join(' ');

const MAX_INPUT = 4_096;
const MAX_OUTPUT = 4_096;

/**
 * @param {object} options
 * @param {(input: object) => Promise<{output: string}>} options.generate
 * @param {object} [options.memory] contrôleur mémoire ; absent, la conversation n'est pas retenue
 * @param {object} [options.logger]
 */
export function createChatResponder({ generate, memory = null, logger = null } = {}) {
  if (typeof generate !== 'function') throw new TypeError('chat_responder_generate_requis');

  return async function respond({ text, deviceId, threadId, eventId = null, onDelta = null }) {
    const body = String(text ?? '');
    if (body.length < 1 || body.length > MAX_INPUT || body.includes('\0')) {
      throw new Error('chat_message_invalide');
    }

    // Le rappel mémoire est facultatif : quand le coffre est fermé, Mina répond sans mémoire
    // plutôt que de refuser, mais ne prétend jamais se souvenir.
    let recalled = '';
    try {
      const recent = await memory?.recentConversation?.({ limit: 20 });
      if (Array.isArray(recent) && recent.length > 0) {
        recalled = recent.map((entry) => `${entry.role ?? 'note'} : ${entry.content ?? ''}`).join('\n').slice(0, 2_000);
      }
    } catch (error) {
      logger?.append?.({ event: 'chat_app_memoire_indisponible', message: String(error?.message ?? error).slice(0, 120) });
    }

    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    if (recalled) messages.push({ role: 'system', content: `Contexte récent :\n${recalled}` });
    messages.push({ role: 'user', content: body });

    let emittedDelta = false;
    const forwardDelta = typeof onDelta === 'function'
      ? async (delta) => {
        await onDelta(delta);
        emittedDelta = true;
      }
      : null;
    const response = await generate({
      messages,
      temperature: 0.3,
      ...(forwardDelta ? { stream: true, onDelta: forwardDelta } : {}),
    });
    const output = String(response?.output ?? '');
    // Les espaces d'un final qui a déjà produit des deltas font partie de la réponse canonique :
    // les retirer ici rendrait `chunks.join('')` différent du final durable. Sans delta, on garde
    // exactement la normalisation historique du canal final-only.
    const answer = emittedDelta ? output : output.trim().slice(0, MAX_OUTPUT);
    if (!answer.trim()) throw new Error('chat_reponse_vide');
    if (emittedDelta && answer.length > MAX_OUTPUT) throw new Error('chat_reponse_trop_longue');

    try {
      // Échange complet : question ET réponse. La mémoire ne doit pas garder une conversation
      // à moitié, sinon la relecture future serait trompeuse.
      await memory?.rememberChatExchange?.({
        eventId: eventId ?? `${deviceId}:${threadId}:${body.length}`,
        deviceId,
        userMessage: body,
        assistantMessage: answer,
      });
    } catch (error) {
      logger?.append?.({ event: 'chat_app_memoire_non_ecrite', message: String(error?.message ?? error).slice(0, 120) });
    }

    return answer;
  };
}

export const CHAT_RESPONDER_LIMITS = Object.freeze({ MAX_INPUT, MAX_OUTPUT });
