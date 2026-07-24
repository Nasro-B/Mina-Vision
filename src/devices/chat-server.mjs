// Serveur du canal `mina_app` : l'autre bout du fil, côté PC.
//
// Ce que ce module garantit :
//   - un appareil doit être APPROUVÉ pour parler (être sur le wifi ne suffit pas) ;
//   - chaque événement reçu est vérifié par signature AVANT tout déchiffrement ;
//   - la clé d'époque n'est jamais transmise en clair : elle est enveloppée par une clé dérivée
//     en ECDH, que seul l'appareil visé peut recalculer ;
//   - quand Mina ne peut pas répondre, on le dit — jamais de réponse fabriquée à sa place.

import { createServer } from 'node:http';
import { createHash, createPublicKey, createVerify, randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { parseChatEvent } from '../contracts/chat.mjs';
import { decodeChatPayload } from '../contracts/chat-payload.mjs';
import { chunkMedia, encodeMediaMetaPayload, encodeMediaChunkPayload } from '../chat/media-chunker.mjs';
import { encodeChatSignatureInput } from '../contracts/chat-binary-codec.mjs';
import { createChatCrypto, deriveDeviceWrapKey, wrapEpochKey } from './chat-crypto.mjs';
import { createMonotonicUlid } from '../contracts/event-id.mjs';
import { createChatLedger } from './chat-ledger.mjs';

const DEFAULT_PORT = 8771;
const MAX_FRAME_BYTES = 262_144;
const HELLO_TIMEOUT_MS = 10_000;
const TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const verifyIdentityProof = ({ deviceId, publicKeySpki, challenge, signature }) => {
  try {
    const bytes = Buffer.from([deviceId, publicKeySpki, challenge]
      .map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('|'), 'utf8');
    return createVerify('sha256')
      .update(bytes)
      .verify({ key: publicKeyFromSpki(publicKeySpki), dsaEncoding: 'der' }, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
};

const publicKeyFromSpki = (spkiBase64) => createPublicKey({
  key: Buffer.from(spkiBase64, 'base64'),
  format: 'der',
  type: 'spki',
});

/**
 * @param {object} options
 * @param {object} options.identity clé d'identité du PC : { privateKey, publicKeySpki }
 * @param {object} options.registry registre d'appareils (createChatDeviceRegistry)
 * @param {(input: {text: string, deviceId: string, threadId: string}) => Promise<string>} options.respond
 * @param {(epoch: number) => Buffer} options.epochKeyFor clé d'époque du PC (autorité)
 */
export function createChatServer({
  identity,
  registry,
  respond,
  epochKeyFor,
  port = DEFAULT_PORT,
  host = '0.0.0.0',
  clock = Date.now,
  logger = null,
  ulid = createMonotonicUlid(),
  ledger = createChatLedger({ clock }),
  /** Handler des payloads média (pièces jointes/chunks). Absent → média acquitté mais ignoré (honnête). */
  handleMedia = null,
} = {}) {
  if (!identity?.privateKey || !identity?.publicKeySpki) throw new TypeError('chat_server_identite_requise');
  if (!registry || typeof registry.isApproved !== 'function') throw new TypeError('chat_server_registre_requis');
  if (typeof respond !== 'function') throw new TypeError('chat_server_respond_requis');
  if (typeof epochKeyFor !== 'function') throw new TypeError('chat_server_epoch_key_requis');

  const note = (event, detail) => logger?.append?.({ event, ...detail });
  const sessions = new Map();
  let http = null;
  let wss = null;

  const rejectSocket = (socket, reason) => {
    note('chat_app_refuse', { reason });
    socket.send(JSON.stringify({ type: 'refused', reason }));
    socket.close(1008, reason);
  };

  async function handleHello(socket, session, message) {
    const { deviceId, publicKeySpki, challenge, signature, pairingCode = null } = message;
    if (!deviceId || !publicKeySpki || !challenge || !signature) {
      rejectSocket(socket, 'identite_incomplete');
      return;
    }
    // La preuve d'identité prouve la possession de la clé privée, pas le droit d'entrer.
    if (!verifyIdentityProof({ deviceId, publicKeySpki, challenge, signature })) {
      rejectSocket(socket, 'preuve_invalide');
      return;
    }
    if (session.expectedChallenge !== challenge) {
      // Sans ce contrôle, une preuve capturée resterait rejouable indéfiniment.
      rejectSocket(socket, 'challenge_inattendu');
      return;
    }

    if (!registry.isApproved(deviceId)) {
      const outcome = registry.approve({ deviceId, publicKeySpki, pairingCode });
      if (!outcome.ok) {
        rejectSocket(socket, outcome.reason);
        return;
      }
      note('chat_app_appaire', { deviceId });
    } else if (registry.publicKeyOf(deviceId) !== publicKeySpki) {
      // Même identifiant, autre clé : c'est un autre appareil qui se fait passer pour celui-ci.
      rejectSocket(socket, 'cle_appareil_changee');
      return;
    }

    const keyEpoch = registry.keyEpoch();
    const wrapKey = deriveDeviceWrapKey({
      privateKey: identity.privateKey,
      peerPublicKey: publicKeyFromSpki(publicKeySpki),
      deviceId,
    });
    const wrapped = wrapEpochKey({
      deviceWrapKey: wrapKey,
      epochKey: Buffer.from(epochKeyFor(keyEpoch)),
      deviceId,
      keyEpoch,
    });
    wrapKey.fill(0);

    session.deviceId = deviceId;
    session.publicKeySpki = publicKeySpki;
    session.keyEpoch = keyEpoch;
    session.authenticated = true;
    sessions.set(deviceId, socket);
    registry.touch(deviceId);

    // Négociation de capacité (W2) : le PC annonce les versions de payload qu'il sait TRAITER.
    // Média (v2) seulement si handleMedia est réellement câblé — sinon le téléphone l'apprend et
    // refuse d'envoyer une pièce jointe qui serait acquittée puis silencieusement perdue.
    const payloadVersions = handleMedia ? [1, 2] : [1];
    socket.send(JSON.stringify({ type: 'epoch', ...wrapped, pcPublicKeySpki: identity.publicKeySpki, payloadVersions }));
    note('chat_app_session_ouverte', { deviceId, keyEpoch, payloadVersions });
  }

  async function handleEvent(socket, session, raw) {
    let event;
    try {
      event = parseChatEvent(raw);
    } catch (error) {
      socket.send(JSON.stringify({ type: 'rejected', reason: error.message }));
      return;
    }
    if (event.senderDeviceId !== session.deviceId) {
      socket.send(JSON.stringify({ type: 'rejected', reason: 'expediteur_inattendu' }));
      return;
    }
    if (event.expiresAtMs <= clock()) {
      socket.send(JSON.stringify({ type: 'rejected', reason: 'evenement_expire' }));
      return;
    }

    const crypto = createChatCrypto({
      signingPrivateKey: identity.privateKey,
      verifyPublicKey: publicKeyFromSpki(session.publicKeySpki),
      epochKey: Buffer.from(epochKeyFor(event.keyEpoch)),
    });

    let payload;
    try {
      // Déchiffrement en OCTETS puis décodage du payload : texte v1 (inchangé) OU média v2.
      payload = decodeChatPayload(crypto.verifyAndDecryptBytes(event));
    } catch (error) {
      socket.send(JSON.stringify({ type: 'rejected', reason: error.message }));
      note('chat_app_evenement_refuse', { deviceId: session.deviceId, reason: error.message });
      return;
    }

    // Accusé AVANT de réfléchir : le téléphone peut vider sa file et cesser de réémettre.
    socket.send(JSON.stringify({ type: 'ack', eventId: event.eventId }));
    registry.touch(session.deviceId);

    // PAYLOAD MÉDIA (pièce jointe / chunk) : assemblé/stocké par l'appelant, jamais de réponse texte
    // par chunk. Le texte v1 continue exactement comme avant, juste en dessous.
    if (payload.version === 2) {
      note('chat_app_media_recu', { deviceId: session.deviceId, eventId: event.eventId, type: payload.type });
      try {
        await handleMedia?.({
          deviceId: session.deviceId, threadId: event.threadId, eventId: event.eventId,
          type: payload.type, meta: payload.meta, binary: payload.binary,
        });
      } catch (error) {
        note('chat_app_media_refuse', { deviceId: session.deviceId, eventId: event.eventId, reason: String(error?.message ?? error).slice(0, 120) });
      }
      return;
    }

    const text = payload.text;
    note('chat_app_message_recu', {
      deviceId: session.deviceId,
      eventId: event.eventId,
      charCount: text.length,
      digest: createHash('sha256').update(text).digest('hex'),
    });

    let answer;
    try {
      // Le ledger garantit UNE génération par événement : un rejeu resert la même réponse au
      // lieu d'en inventer une seconde, différente, pour la même question.
      const produced = await ledger.once(event.eventId, () => respond({
        text, deviceId: session.deviceId, threadId: event.threadId, eventId: event.eventId,
      }));
      answer = produced.answer;
      if (produced.replayed) note('chat_app_rejeu_resservi', { eventId: event.eventId });
    } catch (error) {
      // Mina n'a pas pu répondre : on le DIT, on ne fabrique pas une réponse de remplacement.
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
    socket.send(JSON.stringify(reply));
  }

  /**
   * W6 — envoi d'un média PC → téléphone : découpe (méta payload v2 + chunks), chiffre+signe
   * chaque événement comme une réponse texte, envoie sur la session ACTIVE de l'appareil.
   * Fail-loud : appareil non connecté => erreur claire (pas de file d'attente fantôme — le
   * téléphone lancé re-synchronise, et l'appelant peut réessayer quand l'appareil est là).
   */
  async function sendMediaToDevice(deviceId, { bytes, mime, extraMeta = {} } = {}) {
    const socket = sessions.get(deviceId);
    if (!socket || socket.readyState !== 1) throw new Error('chat_appareil_non_connecte');
    if (!registry.isApproved(deviceId)) throw new Error('chat_appareil_non_appaire');
    const { eventType, meta, chunks } = chunkMedia(Buffer.from(bytes), { mime, extraMeta });
    const keyEpoch = registry.keyEpoch();
    // Crypto dédié à cet envoi : clé de l'époque COURANTE + signature du PC (le téléphone
    // vérifie avec la clé publique du PC reçue à l'appairage).
    const sealCrypto = createChatCrypto({
      signingPrivateKey: identity.privateKey,
      epochKey: Buffer.from(epochKeyFor(keyEpoch)),
    });
    const seal = (routingClass, payload) => {
      const createdAtMs = clock();
      return sealCrypto.encryptAndSign({
        header: {
          version: 2,
          eventId: ulid(),
          threadId: 'thread-main',
          senderDeviceId: 'pc-mina',
          deviceSequence: 0,
          keyEpoch,
          routingClass,
          createdAtMs,
          expiresAtMs: createdAtMs + TTL_MS,
        },
        plaintext: payload,
      });
    };
    socket.send(JSON.stringify(seal('message', encodeMediaMetaPayload({ eventType, meta }))));
    for (const chunk of chunks) {
      socket.send(JSON.stringify(seal('stream', encodeMediaChunkPayload({ mediaId: meta.mediaId, index: chunk.index, binary: chunk.binary }))));
    }
    note('chat_app_media_envoye', { deviceId, mediaId: meta.mediaId, mime, chunkCount: chunks.length });
    return Object.freeze({ mediaId: meta.mediaId, chunkCount: chunks.length, sizeBytes: meta.sizeBytes });
  }

  return Object.freeze({
    async listen() {
      http = createServer((_request, response) => {
        response.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Canal mina_app : WebSocket uniquement.');
      });
      wss = new WebSocketServer({ server: http, path: '/mina-chat', maxPayload: MAX_FRAME_BYTES });

      wss.on('connection', (socket) => {
        const session = {
          authenticated: false,
          deviceId: null,
          expectedChallenge: randomBytes(24).toString('base64'),
        };
        socket.send(JSON.stringify({ type: 'challenge', challenge: session.expectedChallenge }));

        const timer = setTimeout(() => {
          if (!session.authenticated) rejectSocket(socket, 'hello_absent');
        }, HELLO_TIMEOUT_MS);

        socket.on('message', async (data) => {
          let message;
          try {
            message = JSON.parse(String(data));
          } catch {
            socket.send(JSON.stringify({ type: 'rejected', reason: 'json_invalide' }));
            return;
          }
          if (!session.authenticated) {
            if (message.type !== 'hello') {
              rejectSocket(socket, 'hello_attendu');
              return;
            }
            await handleHello(socket, session, message);
            return;
          }
          await handleEvent(socket, session, message);
        });

        socket.on('close', () => {
          clearTimeout(timer);
          if (session.deviceId && sessions.get(session.deviceId) === socket) sessions.delete(session.deviceId);
        });
        socket.on('error', () => socket.close());
      });

      // `ws` RÉÉMET les erreurs du serveur HTTP sur l'instance WebSocketServer : sans écouteur
      // ici, un port déjà pris devient une exception non gérée qui tue le processus (constaté
      // en test). Écouteur permanent des deux côtés, plus un écouteur ponctuel pour l'ouverture.
      const permanent = (error) => note('chat_app_serveur_erreur', { message: error.message });
      http.on('error', permanent);
      wss.on('error', permanent);
      try {
        await new Promise((resolve, reject) => {
          const onError = (error) => reject(error);
          http.once('error', onError);
          wss.once('error', onError);
          http.listen(port, host, () => {
            http.removeListener('error', onError);
            wss.removeListener('error', onError);
            resolve();
          });
        });
      } catch (error) {
        // Échec d'ouverture : on rend les ressources au lieu de laisser un serveur fantôme.
        // `close()` sur un serveur qui n'a jamais écouté émet ERR_SERVER_NOT_RUNNING — l'écouteur
        // permanent ci-dessus doit rester en place pour l'absorber, sinon il devient une
        // exception non gérée qui tue le processus.
        wss.close();
        if (http.listening) http.close();
        wss = null;
        http = null;
        throw error;
      }
      // Port RÉELLEMENT attribué : avec `port: 0` le système en choisit un, et annoncer 0
      // ferait échouer tout appairage.
      const bound = http.address();
      const listeningPort = typeof bound === 'object' && bound ? bound.port : port;
      note('chat_app_serveur_ouvert', { port: listeningPort, host });
      return Object.freeze({ port: listeningPort, host });
    },

    /** Appareils réellement connectés à cet instant — pas ceux qui sont seulement approuvés. */
    connectedDevices: () => Object.freeze([...sessions.keys()]),

    sendMediaToDevice,

    async close() {
      for (const socket of sessions.values()) socket.close(1001, 'arret');
      sessions.clear();
      await new Promise((resolve) => { wss ? wss.close(resolve) : resolve(); });
      await new Promise((resolve) => { http ? http.close(resolve) : resolve(); });
      wss = null;
      http = null;
      note('chat_app_serveur_ferme', {});
    },
  });
}

export const CHAT_SERVER_CONSTANTS = Object.freeze({ DEFAULT_PORT, MAX_FRAME_BYTES, HELLO_TIMEOUT_MS });
