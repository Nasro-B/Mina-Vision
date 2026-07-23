// Registre des appareils autorisés à parler à Mina par le canal `mina_app`.
//
// Le PC est l'autorité : un téléphone n'est jamais admis parce qu'il l'affirme, mais parce que
// Nasro l'a appairé sur le PC avec un code éphémère. Révoquer un appareil ouvre une nouvelle
// époque de clé — l'appareil retiré ne lit plus les messages FUTURS.

import { randomInt } from 'node:crypto';

export const CHAT_DEVICE_REGISTRY_SCHEMA_VERSION = 1;
const PAIRING_CODE_TTL_MS = 5 * 60 * 1_000;
const MAX_DEVICES = 8;
const MAX_PAIRING_ATTEMPTS = 5;

const emptyState = () => ({ devices: {}, keyEpoch: 1, revokedAt: {} });

/**
 * @param {object} options
 * @param {() => number} [options.clock]
 * @param {object} [options.persisted] état chargé depuis le disque (schéma versionné)
 */
export function createChatDeviceRegistry({ clock = Date.now, persisted = null } = {}) {
  const state = persisted && typeof persisted === 'object'
    ? { ...emptyState(), ...persisted, devices: { ...(persisted.devices ?? {}) } }
    : emptyState();

  let pairing = null;
  let failedAttempts = 0;

  const snapshot = () => Object.freeze({
    devices: Object.freeze({ ...state.devices }),
    keyEpoch: state.keyEpoch,
    revokedAt: Object.freeze({ ...state.revokedAt }),
  });

  return Object.freeze({
    schemaVersion: CHAT_DEVICE_REGISTRY_SCHEMA_VERSION,

    snapshot,

    keyEpoch: () => state.keyEpoch,

    /** Liste lisible pour l'interface — sans matériel cryptographique inutile à l'affichage. */
    list: () => Object.entries(state.devices).map(([deviceId, entry]) => Object.freeze({
      deviceId,
      label: entry.label ?? deviceId,
      approvedAtMs: entry.approvedAtMs,
      lastSeenAtMs: entry.lastSeenAtMs ?? null,
      keyEpoch: entry.keyEpoch,
    })),

    isApproved: (deviceId) => Boolean(state.devices[deviceId]),

    publicKeyOf: (deviceId) => state.devices[deviceId]?.publicKeySpki ?? null,

    /**
     * Ouvre une fenêtre d'appairage et renvoie le code à lire sur le PC. Sans ce code, un
     * appareil inconnu du réseau local ne peut pas s'inscrire — être sur le wifi ne suffit pas.
     */
    openPairing({ ttlMs = PAIRING_CODE_TTL_MS } = {}) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      failedAttempts = 0;
      pairing = { code, expiresAtMs: clock() + ttlMs };
      return Object.freeze({ code, expiresAtMs: pairing.expiresAtMs });
    },

    closePairing() {
      pairing = null;
    },

    pairingOpen() {
      if (!pairing) return false;
      if (clock() >= pairing.expiresAtMs) {
        pairing = null;
        return false;
      }
      return true;
    },

    /**
     * Inscrit un appareil. Renvoie `{ ok, reason }` — jamais une exception silencieuse : le
     * refus doit pouvoir être affiché tel quel à l'utilisateur.
     */
    approve({ deviceId, publicKeySpki, pairingCode, label = null }) {
      if (!deviceId || !publicKeySpki) return { ok: false, reason: 'identite_incomplete' };
      if (state.revokedAt[deviceId]) return { ok: false, reason: 'appareil_revoque' };
      if (state.devices[deviceId]) return { ok: true, reason: 'deja_approuve' };

      if (!this.pairingOpen()) return { ok: false, reason: 'appairage_ferme' };
      if (failedAttempts >= MAX_PAIRING_ATTEMPTS) {
        pairing = null;
        return { ok: false, reason: 'trop_de_tentatives' };
      }
      if (pairingCode !== pairing.code) {
        failedAttempts += 1;
        return { ok: false, reason: 'code_incorrect' };
      }
      if (Object.keys(state.devices).length >= MAX_DEVICES) {
        return { ok: false, reason: 'trop_d_appareils' };
      }

      state.devices[deviceId] = {
        publicKeySpki,
        label,
        approvedAtMs: clock(),
        lastSeenAtMs: null,
        keyEpoch: state.keyEpoch,
      };
      // Le code est à usage unique : un code volé ne sert pas deux fois.
      pairing = null;
      return { ok: true, reason: 'approuve' };
    },

    touch(deviceId) {
      const entry = state.devices[deviceId];
      if (entry) entry.lastSeenAtMs = clock();
    },

    /**
     * Retire un appareil ET ouvre l'époque suivante. On ne prétend pas effacer ce qu'il a déjà
     * lu — on garantit seulement qu'il ne lira plus la suite.
     */
    revoke(deviceId) {
      if (!state.devices[deviceId]) return { ok: false, reason: 'appareil_inconnu' };
      delete state.devices[deviceId];
      state.revokedAt[deviceId] = clock();
      state.keyEpoch += 1;
      return { ok: true, keyEpoch: state.keyEpoch };
    },

    /** Réautorise un appareil précédemment révoqué (nouvel appairage exigé). */
    forget(deviceId) {
      delete state.revokedAt[deviceId];
    },
  });
}
