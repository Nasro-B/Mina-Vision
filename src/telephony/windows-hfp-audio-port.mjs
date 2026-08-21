// Port audio HFP Windows (SPEC-MINA-COMMS-001 §6, Phase 6). Implémente l'interface `audioPort` attendue
// par createBluetoothHfpMediaAdapter ({ acquire, release, probe }) et porte la VRAIE orchestration §6 :
// résolution d'un endpoint HFP APPAIRÉ à identité STABLE (le deviceId signé, jamais un nom Bluetooth ou
// une adresse seule, §6.1), ouverture du lien SCO (RX/TX) et sonde de santé. L'I/O audio natif Windows
// (SCO/HFP) est la SEULE pièce non écrite : il est INJECTÉ via `openScoLink` (un binding natif à
// approuver — naudiodon/WASAPI). Absent, le port échoue FERMÉ (`hfp_native_binding_absent`), jamais un
// faux média ni un repli sur le micro ambiant. `enumerateEndpoints` liste les endpoints appairés avec
// leur deviceId signé. Module PUR (la logique) ; le binding natif reste un seam injecté et testable.

export function createWindowsHfpAudioPort({ enumerateEndpoints, openScoLink = null } = {}) {
  if (typeof enumerateEndpoints !== 'function') throw new TypeError('hfp_endpoint_enumerator_required');

  function resolveEndpoint(endpointId) {
    const endpoints = enumerateEndpoints() ?? [];
    const match = endpoints.find((entry) => entry?.endpointId === endpointId);
    if (!match) throw new Error('hfp_endpoint_not_paired'); // pas de fallback : endpoint inconnu = refus
    // §6.1 : une identité stable = le deviceId signé. Un nom/une adresse Bluetooth seul ne suffit pas.
    if (typeof match.deviceId !== 'string' || !match.deviceId) throw new Error('hfp_endpoint_identity_unstable');
    return match;
  }

  return Object.freeze({
    acquire({ endpointId } = {}) {
      const endpoint = resolveEndpoint(endpointId);
      // Fail-closed HONNÊTE tant que l'I/O audio natif n'est pas branché : jamais un faux média.
      if (typeof openScoLink !== 'function') throw new Error('hfp_native_binding_absent');
      const link = openScoLink(endpoint.endpointId);
      if (!link || typeof link.close !== 'function' || typeof link.healthy !== 'function') {
        throw new Error('hfp_sco_link_invalid');
      }
      return link; // sert de handle au pont média (adapter.release/probe passent par close/healthy)
    },

    release(handle) {
      if (handle && typeof handle.close === 'function') handle.close();
    },

    probe(handle) {
      return Boolean(handle && typeof handle.healthy === 'function' && handle.healthy() === true);
    },
  });
}
