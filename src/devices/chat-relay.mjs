// Relais `mina_app` par Firebase — le chemin de secours quand le direct ne passe pas.
//
// Quand le téléphone n'est pas sur le réseau du PC (4G, Wi-Fi étranger), le lien WebSocket
// direct est impossible. Le message transite alors par Firestore. Ce que ça change, et ce que
// ça ne change PAS :
//
//   - Firebase ne voit QUE du ciphertext. Le clair n'existe ni dans la requête, ni au repos.
//   - La signature est vérifiée exactement comme en direct : un document injecté par un tiers
//     est rejeté, pas exécuté. Firebase est un tuyau NON DE CONFIANCE, assumé comme tel.
//   - Le même ledger sert les deux chemins : si un message arrive par direct ET par relais,
//     Mina répond UNE fois.
//   - Le relais ne conserve rien : chaque document est supprimé après remise.

import { createHash } from 'node:crypto';
import { parseChatEvent } from '../contracts/chat.mjs';
import { decodeChatPayload } from '../contracts/chat-payload.mjs';
import { createChatCrypto } from './chat-crypto.mjs';
import { createMonotonicUlid } from '../contracts/event-id.mjs';
import { createChatResponseStream } from './chat-response-stream.mjs';
import { decodeAssistantResponseFrame } from '../contracts/assistant-response-stream.mjs';

const TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const RTDB_FRAME_TTL_MS = 10 * 60 * 1_000;
const MAX_BACKLOG = 200;
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,160}$/u;

/**
 * @param {object} options
 * @param {object} options.firestore façade : { watch(target, handler) -> unsubscribe, put(doc), remove(id) }
 * @param {object} options.identity { privateKey, publicKeySpki }
 * @param {object} options.registry registre d'appareils (source des clés publiques)
 * @param {(epoch: number) => Buffer} options.epochKeyFor
 * @param {object} options.ledger ledger partagé avec le chemin direct
 * @param {(input: object) => Promise<string>} options.respond
 * @param {(input: object) => Promise<object>} [options.handleMedia]
 * @param {{ publishFrame(frame: object): Promise<object> }|null} [options.realtimeStream] transport RTDB déjà authentifié
 * @param {string|null} [options.realtimeOwnerId] propriétaire des trames RTDB
 */
export function createChatRelay({
  firestore,
  identity,
  registry,
  epochKeyFor,
  ledger,
  respond,
  handleMedia = null,
  publicKeyFromSpki,
  clock = Date.now,
  logger = null,
  ulid = createMonotonicUlid(),
  realtimeStream = null,
  realtimeOwnerId = null,
} = {}) {
  if (!firestore?.watch || !firestore?.put || !firestore?.remove) throw new TypeError('chat_relay_firestore_requis');
  if (!identity?.privateKey) throw new TypeError('chat_relay_identite_requise');
  if (!ledger?.once || !ledger?.streamOnce) throw new TypeError('chat_relay_ledger_requis');
  if (typeof respond !== 'function') throw new TypeError('chat_relay_respond_requis');
  if (typeof publicKeyFromSpki !== 'function') throw new TypeError('chat_relay_key_factory_requis');
  if ((realtimeStream === null) !== (realtimeOwnerId === null)
    || (realtimeStream !== null && (typeof realtimeStream.publishFrame !== 'function' || !IDENTIFIER.test(realtimeOwnerId)))) {
    throw new TypeError('chat_relay_realtime_identity_required');
  }

  const note = (event, detail) => logger?.append?.({ event, ...detail });
  let unsubscribe = null;
  let handled = 0;
  let rejected = 0;
  let lastError = null;
  const responseStream = createChatResponseStream({ ledger, respond, makeResponseId: ulid });

  /** Retire les champs de routage : seuls les 13 champs du contrat sont vérifiables. */
  const toEnvelope = (document) => {
    const { target, relayedAtMs, ...envelope } = document;
    return envelope;
  };

  async function handleDocument(document) {
    let event;
    let terminalFramePersisted = false;
    try {
      event = parseChatEvent(toEnvelope(document));
    } catch (error) {
      // Document mal formé : on le retire pour qu'il ne boucle pas, et on dit pourquoi.
      rejected += 1;
      lastError = error.message;
      note('chat_relay_document_refuse', { reason: error.message, id: document?.eventId ?? null });
      await firestore.remove(document.eventId).catch(() => {});
      return;
    }

    if (!registry.isApproved(event.senderDeviceId)) {
      rejected += 1;
      note('chat_relay_appareil_inconnu', { deviceId: event.senderDeviceId });
      await firestore.remove(event.eventId).catch(() => {});
      return;
    }
    if (typeof registry.keyEpoch === 'function' && event.keyEpoch !== registry.keyEpoch()) {
      rejected += 1;
      lastError = 'epoque_perimee';
      note('chat_relay_evenement_refuse', { eventId: event.eventId, reason: 'epoque_perimee' });
      await firestore.remove(event.eventId).catch(() => {});
      return;
    }
    if (event.expiresAtMs <= clock()) {
      rejected += 1;
      note('chat_relay_evenement_expire', { eventId: event.eventId });
      await firestore.remove(event.eventId).catch(() => {});
      return;
    }

    const senderKeySpki = registry.publicKeyOf(event.senderDeviceId);
    const crypto = createChatCrypto({
      signingPrivateKey: identity.privateKey,
      verifyPublicKey: publicKeyFromSpki(senderKeySpki),
      epochKey: Buffer.from(epochKeyFor(event.keyEpoch)),
    });

    let payload;
    try {
      // Vérification AVANT déchiffrement : texte v1 et binaire v2 passent par le même contrat.
      payload = decodeChatPayload(crypto.verifyAndDecryptBytes(event));
    } catch (error) {
      rejected += 1;
      lastError = error.message;
      note('chat_relay_signature_refusee', { eventId: event.eventId, reason: error.message });
      await firestore.remove(event.eventId).catch(() => {});
      return;
    }

    if (payload.version === 2) {
      if (typeof handleMedia !== 'function') {
        lastError = 'chat_media_indisponible';
        note('chat_relay_media_indisponible', { eventId: event.eventId, type: payload.type });
        return;
      }
      try {
        await handleMedia({
          deviceId: event.senderDeviceId,
          threadId: event.threadId,
          eventId: event.eventId,
          type: payload.type,
          meta: payload.meta,
          binary: payload.binary,
        });
      } catch (error) {
        lastError = error.message;
        note('chat_relay_media_echec', { eventId: event.eventId, reason: String(error?.message ?? error).slice(0, 120) });
        return;
      }
      // Supprimé seulement APRÈS traitement réussi ; un échec garde le document pour reprise.
      await firestore.remove(event.eventId).catch(() => {});
      handled += 1;
      return;
    }

    const text = payload.text;

    note('chat_relay_message_recu', {
      deviceId: event.senderDeviceId,
      eventId: event.eventId,
      charCount: text.length,
      digest: createHash('sha256').update(text).digest('hex'),
    });

    try {
      const produced = await responseStream.deliver({
        text,
        deviceId: event.senderDeviceId,
        threadId: event.threadId,
        sourceEventId: event.eventId,
      }, async ({ type, routingClass, payload }) => {
        const createdAtMs = clock();
        const reply = crypto.encryptAndSign({
          header: {
            version: 2,
            eventId: ulid(),
            threadId: event.threadId,
            senderDeviceId: 'pc-mina',
            deviceSequence: event.deviceSequence,
            keyEpoch: event.keyEpoch,
            routingClass,
            createdAtMs,
            expiresAtMs: createdAtMs + TTL_MS,
          },
          plaintext: payload,
        });
        let publishedToRealtime = false;
        if (type === 'assistant.response.chunk' && realtimeStream) {
          try {
            const frame = decodeAssistantResponseFrame(payload);
            await realtimeStream.publishFrame({
              ownerId: realtimeOwnerId,
              responseId: frame.responseId,
              sequence: frame.sequence,
              ciphertext: Buffer.from(JSON.stringify(reply), 'utf8').toString('base64'),
              expiresAtMs: createdAtMs + RTDB_FRAME_TTL_MS,
            });
            publishedToRealtime = true;
          } catch (error) {
            // RTDB est un accélérateur transitoire : une panne ne doit jamais faire perdre une
            // réponse, Firestore reçoit alors exactement la même enveloppe chiffrée.
            note('chat_relay_rtdb_stream_fallback', {
              eventId: reply.eventId,
              reason: String(error?.message ?? error).slice(0, 120),
            });
          }
        }
        if (!publishedToRealtime) await firestore.put({ ...reply, target: 'device', relayedAtMs: createdAtMs });
        terminalFramePersisted = type === 'assistant.response.completed' || type === 'assistant.response.failed';
      });
      if (produced.replayed) note('chat_relay_rejeu_resservi', { eventId: event.eventId });
    } catch (error) {
      lastError = String(error?.message ?? error);
      note('chat_relay_reponse_echec', { eventId: event.eventId, reason: lastError.slice(0, 120) });
      // Le comportement historique est conservé seulement si `failed` a réellement rejoint le
      // relais. Si son écriture a échoué, garder la question évite une perte sans terminal.
      if (!terminalFramePersisted) return;
    }
    // La question relayée est retirée APRÈS le dépôt d'un terminal : une coupure entre les deux
    // laisse la question en place et le message repartira, plutôt que de disparaître sans réponse.
    await firestore.remove(event.eventId).catch(() => {});
    handled += 1;
  }

  return Object.freeze({
    start() {
      if (unsubscribe) return;
      unsubscribe = firestore.watch('pc', async (documents) => {
        // Borne dure : un relais saturé ne doit pas noyer le PC.
        for (const document of documents.slice(0, MAX_BACKLOG)) {
          await handleDocument(document).catch((error) => {
            lastError = error.message;
            note('chat_relay_erreur', { message: error.message });
          });
        }
      });
      note('chat_relay_demarre', {});
    },

    stop() {
      unsubscribe?.();
      unsubscribe = null;
      note('chat_relay_arrete', {});
    },

    status: () => Object.freeze({
      watching: Boolean(unsubscribe),
      handled,
      rejected,
      lastError,
      realtime: Boolean(realtimeStream),
    }),
  });
}
