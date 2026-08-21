// Pont média Bluetooth HFP (SPEC-MINA-COMMS-001 §6, Phase 6, Option B). Logique PURE du média d'appel :
// verrouille UN endpoint HFP par appel, isole strictement les deux téléphones (router l'un n'injecte
// jamais dans l'appel de l'autre), INTERDIT tout fallback audio général (endpoint indisponible =
// échec fermé, jamais le micro ambiant ni la sortie PC par défaut, §6.1), et surveille la santé du
// média — si elle tombe, l'appel DOIT s'arrêter (jamais un appel silencieux qui prétend continuer,
// §7). L'identité est le `deviceId` signé : un nom Bluetooth ou une IP ne prend jamais un endpoint.
// Le vrai I/O audio Windows est INJECTÉ (`audioPort`) et prouvé séparément par la porte live §6 ;
// ici tout est testable sans matériel. Module PUR, non câblé au runtime.

export function createBluetoothHfpMediaAdapter({ audioPort, now = () => 0 } = {}) {
  if (typeof audioPort?.acquire !== 'function' || typeof audioPort?.release !== 'function'
    || typeof audioPort?.probe !== 'function') {
    throw new TypeError('hfp_audio_port_required');
  }
  const endpointOwner = new Map(); // endpointId -> deviceId signé (propriété exclusive)
  const deviceEndpoint = new Map(); // deviceId -> endpointId
  const sessions = new Map(); // callId -> { callId, deviceId, endpointId, handle, startedAt }

  const lockedEndpoints = () => new Set([...sessions.values()].map((session) => session.endpointId));

  return Object.freeze({
    // Appaire un endpoint HFP à un deviceId signé. Reconnexion (même paire) = idempotente. Un endpoint
    // déjà possédé par un autre deviceId est REFUSÉ : l'identité ne se vole pas par un nom BT/IP (§6.1).
    bind({ deviceId, endpointId } = {}) {
      if (!deviceId || !endpointId) throw new TypeError('hfp_bind_invalid');
      const owner = endpointOwner.get(endpointId);
      if (owner && owner !== deviceId) throw new Error('hfp_endpoint_identity_conflict');
      endpointOwner.set(endpointId, deviceId);
      deviceEndpoint.set(deviceId, endpointId);
      return Object.freeze({ deviceId, endpointId });
    },

    lockForCall({ callId, deviceId } = {}) {
      if (!callId || !deviceId) throw new TypeError('hfp_lock_invalid');
      const endpointId = deviceEndpoint.get(deviceId);
      if (!endpointId) throw new Error('hfp_endpoint_unbound'); // appareil non appairé HFP : pas de fallback
      if (lockedEndpoints().has(endpointId)) throw new Error('hfp_endpoint_busy'); // un seul endpoint par appel
      let handle;
      try {
        handle = audioPort.acquire({ endpointId });
      } catch {
        // Fail-closed : jamais de repli sur l'audio général / le micro ambiant (§6.1).
        throw new Error('hfp_endpoint_unavailable');
      }
      sessions.set(callId, { callId, deviceId, endpointId, handle, startedAt: now() });
      return Object.freeze({ callId, deviceId, endpointId });
    },

    isLocked(endpointId) { return lockedEndpoints().has(endpointId); },

    // Santé du média pendant l'appel. Perdue → l'appel doit s'arrêter (jamais silencieux, §7).
    checkHealth(callId) {
      const session = sessions.get(callId);
      if (!session) throw new Error('hfp_session_unknown');
      const healthy = audioPort.probe(session.handle) === true;
      return Object.freeze({ callId, healthy, mustStop: !healthy });
    },

    release(callId) {
      const session = sessions.get(callId);
      if (!session) return false;
      audioPort.release(session.handle);
      sessions.delete(callId);
      return true;
    },

    activeSessions() { return sessions.size; },
  });
}
