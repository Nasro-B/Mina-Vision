// Canal `mina_app` côté PC : assemble registre, clés d'époque, serveur et persistance.
//
// Clés d'époque : dérivées de la clé maîtresse du coffre (HKDF), jamais stockées séparément.
// Conséquence voulue — coffre verrouillé, le canal ne peut pas servir : Mina ne répond pas
// depuis le téléphone tant que la mémoire n'est pas déverrouillée, au lieu de répondre avec
// une identité amputée de sa mémoire.

import { hkdfSync } from 'node:crypto';
import { createChatDeviceRegistry } from './chat-device-registry.mjs';
import { createChatLedger } from './chat-ledger.mjs';
import { createChatRelay } from './chat-relay.mjs';
import { createChatServer } from './chat-server.mjs';

const EPOCH_INFO = 'mina-chat-epoch-v1';
const KEY_BYTES = 32;

/**
 * @param {object} options
 * @param {() => Buffer|null} options.masterKey clé maîtresse du coffre, null si verrouillé
 * @param {object} options.identity { privateKey, publicKeySpki } — identité PC
 * @param {object} options.store store JSON versionné pour le registre d'appareils
 * @param {(input: {text: string, deviceId: string, threadId: string}) => Promise<string>} options.respond
 */
export function createChatChannel({
  masterKey,
  identity,
  store,
  ledgerStore = null,
  /** Façade Firestore ; absente, le canal fonctionne en direct SEUL et le dit. */
  firestore = null,
  publicKeyFromSpki = null,
  respond,
  /** Factory du handler média, composée une seule fois avec le ledger partagé direct/Firebase. */
  createMediaHandler = null,
  /** Compatibilité appelants existants : handler média déjà composé. */
  handleMedia = null,
  port,
  host,
  clock = Date.now,
  logger = null,
} = {}) {
  if (typeof masterKey !== 'function') throw new TypeError('chat_channel_master_key_requis');
  if (typeof respond !== 'function') throw new TypeError('chat_channel_respond_requis');

  let registry = createChatDeviceRegistry({ clock });
  const ledger = createChatLedger({ store: ledgerStore, clock });
  let relay = null;
  let server = null;
  let mediaHandler = null;
  let listening = null;
  let lastError = null;

  const persist = async () => {
    if (!store?.save) return;
    await store.save(registry.snapshot()).catch((error) => {
      // Un registre non persisté redemanderait un appairage au prochain démarrage : on le dit.
      lastError = `registre non enregistré : ${error.message}`;
      logger?.append?.({ event: 'chat_app_registre_non_persiste', message: error.message });
    });
  };

  const epochKeyFor = (epoch) => {
    const master = masterKey();
    if (!master) throw new Error('chat_coffre_verrouille');
    return Buffer.from(hkdfSync(
      'sha256',
      master,
      Buffer.from(`mina-chat-epoch-${Number(epoch)}`, 'utf8'),
      Buffer.from(EPOCH_INFO, 'utf8'),
      KEY_BYTES,
    ));
  };

  return Object.freeze({
    async load() {
      if (!store?.load) return;
      const loaded = await store.load({ defaults: null }).catch(() => null);
      if (loaded?.data) registry = createChatDeviceRegistry({ clock, persisted: loaded.data });
      await ledger.load();
    },

    async start() {
      if (server) return listening;
      if (!identity?.privateKey) {
        lastError = 'identité PC indisponible';
        return null;
      }
      mediaHandler ??= createMediaHandler?.({
        completeOnce: (mediaId, work) => ledger.once(`media:${mediaId}`, work),
      }) ?? handleMedia;
      server = createChatServer({
        identity, registry, respond, epochKeyFor, port, host, clock, logger, ledger, handleMedia: mediaHandler,
      });
      // Le relais Firebase est INDÉPENDANT du direct : il démarre même si le port local est
      // pris, sinon un PC mal configuré perdrait aussi le chemin de secours.
      if (firestore && publicKeyFromSpki && !relay) {
        relay = createChatRelay({
          firestore, identity, registry, epochKeyFor, ledger, respond, handleMedia: mediaHandler, publicKeyFromSpki, clock, logger,
        });
        relay.start();
      }
      try {
        listening = await server.listen();
        lastError = null;
      } catch (error) {
        // Port occupé, pare-feu : on remonte la cause exacte au lieu d'un canal « actif » faux.
        lastError = error.message;
        server = null;
        listening = null;
      }
      return listening;
    },

    async stop() {
      relay?.stop();
      relay = null;
      if (!server) return;
      await server.close();
      server = null;
      listening = null;
    },

    /** Vérité sur le canal : jamais « prêt » si le serveur n'écoute pas réellement. */
    status() {
      return Object.freeze({
        listening: Boolean(listening),
        address: listening ? `${listening.host}:${listening.port}` : null,
        port: listening?.port ?? null,
        vaultUnlocked: Boolean(masterKey()),
        pairingOpen: registry.pairingOpen(),
        keyEpoch: registry.keyEpoch(),
        processedEvents: ledger.size(),
        // Vérité sur le secours : « relais actif » seulement s'il écoute vraiment.
        relay: relay?.status() ?? Object.freeze({ watching: false, handled: 0, rejected: 0, lastError: 'relais non configuré' }),
        generationsInFlight: ledger.inFlight(),
        connectedDevices: server?.connectedDevices?.() ?? [],
        devices: registry.list(),
        lastError,
      });
    },

    openPairing(options) {
      const opened = registry.openPairing(options);
      logger?.append?.({ event: 'chat_app_appairage_ouvert', expiresAtMs: opened.expiresAtMs });
      return opened;
    },

    /** W6 — envoi d'un média PC → téléphone connecté. Fail-loud si le canal n'écoute pas. */
    async sendMedia(deviceId, media) {
      if (!server) throw new Error('chat_canal_inactif');
      return server.sendMediaToDevice(deviceId, media);
    },

    /** Appels — demande d'ouverture du composeur pré-rempli sur le téléphone (ACTION_DIAL). */
    async sendDial(deviceId, request) {
      if (!server) throw new Error('chat_canal_inactif');
      return server.sendDialToDevice(deviceId, request);
    },

    closePairing() {
      registry.closePairing();
    },

    async revoke(deviceId) {
      const outcome = registry.revoke(deviceId);
      if (outcome.ok) {
        // F-02 : couper la session VIVANTE, pas seulement l'autorisation future. Sans cette
        // fermeture, une WebSocket déjà ouverte continuait d'obtenir des accusés et des réponses
        // après la révocation. Fait AVANT la persistance : la coupure ne doit pas attendre un I/O.
        server?.disconnectDevice?.(deviceId, 'appareil_revoque');
        await persist();
        logger?.append?.({ event: 'chat_app_appareil_revoque', deviceId, keyEpoch: outcome.keyEpoch });
      }
      return outcome;
    },

    async persistNow() {
      await persist();
      await ledger.persist();
    },

    devices: () => registry.list(),
  });
}
