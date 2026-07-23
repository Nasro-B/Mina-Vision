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
import { createChatCrypto } from './chat-crypto.mjs';
import { createMonotonicUlid } from '../contracts/event-id.mjs';

const TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_BACKLOG = 200;

/**
 * @param {object} options
 * @param {object} options.firestore façade : { watch(target, handler) -> unsubscribe, put(doc), remove(id) }
 * @param {object} options.identity { privateKey, publicKeySpki }
 * @param {object} options.registry registre d'appareils (source des clés publiques)
 * @param {(epoch: number) => Buffer} options.epochKeyFor
 * @param {object} options.ledger ledger partagé avec le chemin direct
 * @param {(input: object) => Promise<string>} options.respond
 */
export function createChatRelay({
  firestore,
  identity,
  registry,
  epochKeyFor,
  ledger,
  respond,
  publicKeyFromSpki,
  clock = Date.now,
  logger = null,
  ulid = createMonotonicUlid(),
} = {}) {
  if (!firestore?.watch || !firestore?.put || !firestore?.remove) throw new TypeError('chat_relay_firestore_requis');
  if (!identity?.privateKey) throw new TypeError('chat_relay_identite_requise');
  if (!ledger?.once) throw new TypeError('chat_relay_ledger_requis');
  if (typeof respond !== 'function') throw new TypeError('chat_relay_respond_requis');
  if (typeof publicKeyFromSpki !== 'function') throw new TypeError('chat_relay_key_factory_requis');

  const note = (event, detail) => logger?.append?.({ event, ...detail });
  let unsubscribe = null;
  let handled = 0;
  let rejected = 0;
  let lastError = null;

  /** Retire les champs de routage : seuls les 13 champs du contrat sont vérifiables. */
  const toEnvelope = (document) => {
    const { target, relayedAtMs, ...envelope } = document;
    return envelope;
  };

  async function handleDocument(document) {
    let event;
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

    let text;
    try {
      // Vérification AVANT déchiffrement : un document injecté dans Firestore n'a aucune chance.
      text = crypto.verifyAndDecrypt(event);
    } catch (error) {
      rejected += 1;
      lastError = error.message;
      note('chat_relay_signature_refusee', { eventId: event.eventId, reason: error.message });
      await firestore.remove(event.eventId).catch(() => {});
      return;
    }

    note('chat_relay_message_recu', {
      deviceId: event.senderDeviceId,
      eventId: event.eventId,
      charCount: text.length,
      digest: createHash('sha256').update(text).digest('hex'),
    });

    let answer;
    try {
      // MÊME ledger que le direct : arrivé par les deux chemins, le message n'obtient qu'une
      // seule réponse — c'est ce qui rend le double transport sûr.
      const produced = await ledger.once(event.eventId, () => respond({
        text, deviceId: event.senderDeviceId, threadId: event.threadId, eventId: event.eventId,
      }));
      answer = produced.answer;
      if (produced.replayed) note('chat_relay_rejeu_resservi', { eventId: event.eventId });
    } catch (error) {
      answer = `Je n'ai pas pu traiter ce message : ${error.message}`;
    }

    const createdAtMs = clock();
    const reply = crypto.encryptAndSign({
      header: {
        version: 2,
        eventId: ulid(),
        threadId: event.threadId,
        senderDeviceId: 'pc-mina',
        deviceSequence: event.deviceSequence,
        keyEpoch: event.keyEpoch,
        routingClass: 'message',
        createdAtMs,
        expiresAtMs: createdAtMs + TTL_MS,
      },
      plaintext: answer,
    });

    await firestore.put({ ...reply, target: 'device', relayedAtMs: createdAtMs });
    // La question relayée est retirée APRÈS le dépôt de la réponse : une coupure entre les deux
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
    }),
  });
}
