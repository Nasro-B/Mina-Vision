import { createMonotonicUlid } from '../contracts/event-id.mjs';
import { encodeAssistantResponseFrame } from '../contracts/assistant-response-stream.mjs';

const FINAL_TYPES = new Set(['assistant.response.completed', 'assistant.response.failed']);

function failureCode(error) {
  const message = String(error?.message ?? error).toLowerCase();
  if (error?.name === 'AbortError' || /cancel|abort/u.test(message)) return 'generation_cancelled';
  if (/timeout|trop_longue/u.test(message)) return 'provider_timeout';
  if (/unavailable|indisponible/u.test(message)) return 'provider_unavailable';
  return 'generation_failed';
}

function routingClass(type) {
  return FINAL_TYPES.has(type) ? 'message' : 'stream';
}

/**
 * Orchestre un seul stream durable par message source. Le générateur ne peut émettre un delta
 * qu'après son append dans le ledger ; les rejeux relisent donc exactement la même séquence.
 */
export function createChatResponseStream({
  ledger,
  respond,
  makeResponseId = createMonotonicUlid(),
} = {}) {
  if (typeof ledger?.streamOnce !== 'function') throw new TypeError('chat_response_stream_ledger_requis');
  if (typeof respond !== 'function') throw new TypeError('chat_response_stream_respond_requis');
  if (typeof makeResponseId !== 'function') throw new TypeError('chat_response_stream_id_factory_requise');

  return Object.freeze({
    async deliver(input, emit) {
      if (typeof emit !== 'function') throw new TypeError('chat_response_stream_emit_requis');
      const sourceEventId = input?.sourceEventId;

      const emitFrame = async ({ type, responseId, sequence, text, code }) => {
        const payload = encodeAssistantResponseFrame({
          type,
          responseId,
          sourceEventId,
          sequence,
          text,
          code,
        });
        await emit(Object.freeze({ type, routingClass: routingClass(type), payload }));
      };

      let live = null;
      let result;
      try {
        result = await ledger.streamOnce(sourceEventId, async ({ responseId, append }) => {
          let sequence = 0;
          live = { responseId, sequence };
          await emitFrame({ type: 'assistant.response.started', responseId, sequence });

          const answer = await respond({
            ...input,
            onDelta: async (delta) => {
              const nextSequence = sequence + 1;
              // Validation AVANT le persist : un delta qui ne peut pas voyager ne rejoint jamais
              // le ledger et ne peut donc pas produire un rejeu irréconciliable.
              const payload = encodeAssistantResponseFrame({
                type: 'assistant.response.chunk',
                responseId,
                sourceEventId,
                sequence: nextSequence,
                text: delta,
              });
              await append(delta);
              await emit(Object.freeze({
                type: 'assistant.response.chunk', routingClass: 'stream', payload,
              }));
              sequence = nextSequence;
              live.sequence = sequence;
            },
          });

          // Le final est validé avant que streamOnce le marque comme réponse durable.
          encodeAssistantResponseFrame({
            type: 'assistant.response.completed',
            responseId,
            sourceEventId,
            sequence: sequence + 1,
            text: answer,
          });
          return answer;
        }, {
          // Le factory n'est appelé que pour une nouvelle génération ou un ancien record à migrer.
          // La trame started valide aussi immédiatement l'ULID produit, avant toute persistance.
          makeResponseId: () => {
            const responseId = makeResponseId();
            encodeAssistantResponseFrame({
              type: 'assistant.response.started', responseId, sourceEventId, sequence: 0,
            });
            return responseId;
          },
        });
      } catch (error) {
        // Aucun final n'a été persisté dans ce chemin : `failed` termine seulement l'overlay côté
        // client et l'erreur reste remontée à l'appelant pour sa politique de reprise.
        if (live) {
          try {
            await emitFrame({
              type: 'assistant.response.failed',
              responseId: live.responseId,
              sequence: live.sequence + 1,
              code: failureCode(error),
            });
          } catch {
            // Ne jamais remplacer l'erreur de génération/persistance par une erreur d'émission.
          }
        }
        throw error;
      }

      if (result.replayed) {
        await emitFrame({ type: 'assistant.response.started', responseId: result.responseId, sequence: 0 });
        for (const [index, text] of result.chunks.entries()) {
          await emitFrame({
            type: 'assistant.response.chunk', responseId: result.responseId, sequence: index + 1, text,
          });
        }
      }
      await emitFrame({
        type: 'assistant.response.completed',
        responseId: result.responseId,
        sequence: result.chunks.length + 1,
        text: result.answer,
      });
      return result;
    },
  });
}
